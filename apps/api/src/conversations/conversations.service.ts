import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConversationType, MemberRole, Prisma } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { decodeCursor, encodeCursor } from '../common/utils/cursor.util';
import { WsEvents } from '../common/realtime/ws-events';
import { REALTIME_EMITTER, type RealtimeEmitter } from '../common/realtime/realtime-emitter.interface';
import { Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import {
  toConversationDto,
  type ConversationDto,
  type MemberWithUser,
} from './conversation.mapper';
import type { CreateConversationDto } from './dto/create-conversation.dto';
import type { ListConversationsDto } from './dto/list-conversations.dto';
import type { UpdateConversationDto } from './dto/update-conversation.dto';

const memberUserSelect = {
  id: true,
  name: true,
  username: true,
  avatarUrl: true,
  status: true,
  lastSeenAt: true,
  createdAt: true,
} as const;

const conversationInclude = {
  members: { include: { user: { select: memberUserSelect } } },
  messages: { orderBy: { createdAt: 'desc' as const }, take: 1 },
} as const;

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly config: AppConfigService,
    @Inject(REALTIME_EMITTER) private readonly emitter: RealtimeEmitter,
  ) {}

  // -------------------------------------------------------------------------
  // Membership primitives used by the messages module
  // -------------------------------------------------------------------------

  async assertMembership(conversationId: string, userId: string) {
    const membership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      include: { conversation: { select: { id: true, type: true } } },
    });

    if (!membership) {
      // 404 rather than 403 — do not leak existence of conversations the
      // caller has no business knowing about.
      throw new NotFoundException('Conversation not found');
    }

    return membership;
  }

  async requireRole(
    conversationId: string,
    userId: string,
    allowed: MemberRole[],
  ): Promise<void> {
    const membership = await this.assertMembership(conversationId, userId);
    if (!allowed.includes(membership.role)) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }
  }

  async getMemberIds(conversationId: string): Promise<string[]> {
    const rows = await this.prisma.conversationMember.findMany({
      where: { conversationId },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  // -------------------------------------------------------------------------
  // Listing
  // -------------------------------------------------------------------------

  async list(userId: string, query: ListConversationsDto) {
    const limit = query.limit ?? 30;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const where: Prisma.ConversationWhereInput = {
      members: { some: { userId } },
      ...(cursor
        ? {
            OR: [
              { lastMessageAt: { lt: new Date(cursor.createdAt) } },
              {
                lastMessageAt: new Date(cursor.createdAt),
                id: { lt: cursor.id },
              },
            ],
          }
        : {}),
    };

    const conversations = await this.prisma.conversation.findMany({
      where,
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: conversationInclude,
    });

    const hasMore = conversations.length > limit;
    const page = hasMore ? conversations.slice(0, limit) : conversations;

    const unread = await this.batchUnreadCounts(
      userId,
      page.map((c) => c.id),
    );

    const items = page.map((c) =>
      toConversationDto(c, userId, unread.get(c.id) ?? 0),
    );

    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ createdAt: last.lastMessageAt.toISOString(), id: last.id })
        : null;

    return { items, nextCursor };
  }

  /**
   * One query for every conversation on the page. The correlated predicate
   * uses `ConversationMember.lastReadAt`, so the planner can serve the count
   * straight from the `(conversationId, createdAt DESC)` index without
   * touching the read-receipts table at all.
   */
  private async batchUnreadCounts(
    userId: string,
    conversationIds: string[],
  ): Promise<Map<string, number>> {
    if (conversationIds.length === 0) return new Map();

    const rows = await this.prisma.$queryRaw<Array<{ conversationId: string; unreadCount: number }>>(
      Prisma.sql`
        SELECT cm."conversationId" AS "conversationId",
               COUNT(m.id)::int   AS "unreadCount"
        FROM   "ConversationMember" cm
        LEFT JOIN "Message" m
               ON m."conversationId" = cm."conversationId"
              AND m."senderId" <> cm."userId"
              AND m."deletedAt" IS NULL
              AND (cm."lastReadAt" IS NULL OR m."createdAt" > cm."lastReadAt")
        WHERE  cm."userId" = ${userId}
          AND  cm."conversationId" IN (${Prisma.join(conversationIds)})
        GROUP BY cm."conversationId"
      `,
    );

    const map = new Map<string, number>();
    for (const id of conversationIds) map.set(id, 0);
    for (const row of rows) map.set(row.conversationId, Number(row.unreadCount));
    return map;
  }

  // -------------------------------------------------------------------------
  // Detail
  // -------------------------------------------------------------------------

  async getById(conversationId: string, userId: string): Promise<ConversationDto> {
    await this.assertMembership(conversationId, userId);

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: conversationInclude,
    });

    if (!conversation) throw new NotFoundException('Conversation not found');

    const unread = await this.batchUnreadCounts(userId, [conversationId]);
    return toConversationDto(conversation, userId, unread.get(conversationId) ?? 0);
  }

  // -------------------------------------------------------------------------
  // Creation
  // -------------------------------------------------------------------------

  async findOrCreateDirect(userId: string, participantId: string): Promise<ConversationDto> {
    if (userId === participantId) {
      throw new BadRequestException('You cannot start a direct conversation with yourself');
    }

    const participant = await this.users.findPublicById(participantId);
    if (!participant) throw new NotFoundException('User not found');

    // Deterministic key — uniqueness is enforced by the DB, not by application
    // read-then-write, so two concurrent requests cannot create two DMs.
    const directKey = [userId, participantId].sort().join(':');

    const existing = await this.prisma.conversation.findUnique({
      where: { directKey },
      include: conversationInclude,
    });
    if (existing) return toConversationDto(existing, userId, 0);

    try {
      const created = await this.prisma.conversation.create({
        data: {
          type: ConversationType.DIRECT,
          directKey,
          createdById: userId,
          members: {
            create: [
              { userId, role: MemberRole.MEMBER },
              { userId: participantId, role: MemberRole.MEMBER },
            ],
          },
        },
        include: conversationInclude,
      });

      this.logger.log(`Direct conversation created: ${created.id}`);

      // Real-time side effects happen after commit, never before.
      this.emitter.emitToUser(participantId, WsEvents.PresenceUpdate, {
        userId,
        status: 'ONLINE',
      });
      this.emitter.emitToConversation(created.id, 'conversation:created', {
        conversationId: created.id,
      });

      return toConversationDto(created, userId, 0);
    } catch (err) {
      // Lost a race against a concurrent create — refetch and return.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const created = await this.prisma.conversation.findUnique({
          where: { directKey },
          include: conversationInclude,
        });
        if (created) return toConversationDto(created, userId, 0);
      }
      throw err;
    }
  }

  async createGroup(userId: string, dto: CreateConversationDto): Promise<ConversationDto> {
    if (!dto.name || !dto.memberIds || dto.memberIds.length === 0) {
      throw new BadRequestException('Group conversations require a name and at least one member');
    }

    const uniqueIds = Array.from(new Set(dto.memberIds.filter((id) => id !== userId)));

    const existingUsers = await this.users.findManyPublicByIds(uniqueIds);
    if (existingUsers.length !== uniqueIds.length) {
      throw new BadRequestException('One or more members do not exist');
    }

    const created = await this.prisma.conversation.create({
      data: {
        type: ConversationType.GROUP,
        name: dto.name,
        createdById: userId,
        members: {
          create: [
            { userId, role: MemberRole.OWNER },
            ...uniqueIds.map((id) => ({ userId: id, role: MemberRole.MEMBER })),
          ],
        },
      },
      include: conversationInclude,
    });

    this.logger.log(`Group conversation created: ${created.id}`);

    // Everyone is now a member — drop them into the room and tell them.
    for (const memberId of [userId, ...uniqueIds]) {
      this.emitter.emitToUser(memberId, 'conversation:created', {
        conversationId: created.id,
      });
    }

    return toConversationDto(created, userId, 0);
  }

  async create(userId: string, dto: CreateConversationDto): Promise<ConversationDto> {
    if (dto.type === ConversationType.DIRECT) {
      if (!dto.participantId) {
        throw new BadRequestException('participantId is required for direct conversations');
      }
      return this.findOrCreateDirect(userId, dto.participantId);
    }
    return this.createGroup(userId, dto);
  }

  // -------------------------------------------------------------------------
  // Group management
  // -------------------------------------------------------------------------

  async update(
    conversationId: string,
    userId: string,
    dto: UpdateConversationDto,
  ): Promise<ConversationDto> {
    const membership = await this.assertMembership(conversationId, userId);

    if (membership.conversation.type !== ConversationType.GROUP) {
      throw new BadRequestException('Only group conversations can be renamed');
    }

    if (membership.role !== MemberRole.OWNER && membership.role !== MemberRole.ADMIN) {
      throw new ForbiddenException('Only owners and admins can rename the group');
    }

    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { name: dto.name },
      include: conversationInclude,
    });

    const memberIds = await this.getMemberIds(conversationId);
    const payload = { conversationId, name: dto.name, actorId: userId };

    for (const memberId of memberIds) {
      this.emitter.emitToUser(memberId, 'conversation:updated', payload);
    }

    return toConversationDto(updated, userId, 0);
  }

  async remove(conversationId: string, userId: string): Promise<void> {
    const membership = await this.assertMembership(conversationId, userId);

    if (membership.conversation.type !== ConversationType.GROUP) {
      throw new BadRequestException('Direct conversations cannot be deleted');
    }

    if (membership.role !== MemberRole.OWNER) {
      throw new ForbiddenException('Only the group owner can delete the conversation');
    }

    const memberIds = await this.getMemberIds(conversationId);

    await this.prisma.conversation.delete({ where: { id: conversationId } });

    for (const memberId of memberIds) {
      this.emitter.emitToUser(memberId, 'conversation:deleted', { conversationId });
    }
  }

  async addMember(conversationId: string, actorId: string, targetUserId: string): Promise<ConversationDto> {
    await this.requireRole(conversationId, actorId, [MemberRole.OWNER, MemberRole.ADMIN]);

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, type: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.type !== ConversationType.GROUP) {
      throw new BadRequestException('Cannot add members to a direct conversation');
    }

    const target = await this.users.findPublicById(targetUserId);
    if (!target) throw new NotFoundException('User not found');

    try {
      await this.prisma.conversationMember.create({
        data: { conversationId, userId: targetUserId, role: MemberRole.MEMBER },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('User is already a member of this conversation');
      }
      throw err;
    }

    this.emitter.emitToUser(targetUserId, 'conversation:created', { conversationId });

    const memberIds = await this.getMemberIds(conversationId);
    for (const memberId of memberIds) {
      this.emitter.emitToUser(memberId, 'conversation:member-added', {
        conversationId,
        userId: targetUserId,
      });
    }

    return this.getById(conversationId, actorId);
  }

  async removeMember(conversationId: string, actorId: string, targetUserId: string): Promise<void> {
    const actorMembership = await this.assertMembership(conversationId, actorId);

    if (actorMembership.conversation.type !== ConversationType.GROUP) {
      throw new BadRequestException('Cannot remove members from a direct conversation');
    }

    const isSelfLeave = actorId === targetUserId;

    if (!isSelfLeave) {
      if (actorMembership.role !== MemberRole.OWNER && actorMembership.role !== MemberRole.ADMIN) {
        throw new ForbiddenException('Only owners and admins can remove members');
      }

      const target = await this.prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId, userId: targetUserId } },
      });
      if (!target) throw new NotFoundException('User is not a member of this conversation');

      if (target.role === MemberRole.OWNER) {
        throw new ForbiddenException('The group owner cannot be removed');
      }
    } else if (actorMembership.role === MemberRole.OWNER) {
      // Leaving owners must hand off or the group becomes unmanageable.
      const successor = await this.prisma.conversationMember.findFirst({
        where: { conversationId, userId: { not: actorId } },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      });

      if (!successor) {
        // Last member — delete the whole conversation instead of orphaning it.
        await this.prisma.conversation.delete({ where: { id: conversationId } });
        this.emitter.emitToUser(actorId, 'conversation:deleted', { conversationId });
        return;
      }

      await this.prisma.conversationMember.update({
        where: { id: successor.id },
        data: { role: MemberRole.OWNER },
      });
    }

    await this.prisma.conversationMember.delete({
      where: { conversationId_userId: { conversationId, userId: targetUserId } },
    });

    const memberIds = await this.getMemberIds(conversationId);

    for (const memberId of memberIds) {
      this.emitter.emitToUser(memberId, 'conversation:member-removed', {
        conversationId,
        userId: targetUserId,
      });
    }

    this.emitter.emitToUser(targetUserId, 'conversation:removed', {
      conversationId,
      userId: targetUserId,
    });
  }

  // -------------------------------------------------------------------------
  // Read state
  // -------------------------------------------------------------------------

  async markRead(conversationId: string, userId: string, messageId: string): Promise<void> {
    await this.assertMembership(conversationId, userId);

    const message = await this.prisma.message.findFirst({
      where: { id: messageId, conversationId },
      select: { id: true, createdAt: true },
    });

    if (!message) throw new NotFoundException('Message not found in this conversation');

    const readAt = new Date();

    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadMessageId: message.id, lastReadAt: message.createdAt },
    });

    await this.emitter.emitToConversation(conversationId, WsEvents.MessageRead, {
      conversationId,
      userId,
      messageId: message.id,
      readAt: readAt.toISOString(),
    });
  }
}