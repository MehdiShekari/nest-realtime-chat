import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConversationType, MemberRole, NotificationType, Prisma } from '@prisma/client';
import { WsEvents } from '../common/realtime/ws-events';
import {
  REALTIME_EMITTER,
  type RealtimeEmitter,
} from '../common/realtime/realtime-emitter.interface';
import { decodeCursor, encodeCursor } from '../common/utils/cursor.util';
import { ConversationsService } from '../conversations/conversations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';
import { toMessageDto, type MessageDto } from './message.mapper';
import type { ListMessagesDto } from './dto/list-messages.dto';
import type { SendMessageDto } from './dto/send-message.dto';
import type { UpdateMessageDto } from './dto/update-message.dto';

const MAX_EDIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_MENTIONS_PER_MESSAGE = 20;

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly notifications: NotificationsService,
    private readonly presence: PresenceService,
    @Inject(REALTIME_EMITTER) private readonly emitter: RealtimeEmitter,
  ) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(conversationId: string, userId: string, query: ListMessagesDto) {
    await this.conversations.assertMembership(conversationId, userId);

    const limit = query.limit ?? 30;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const where: Prisma.MessageWhereInput = {
      conversationId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.createdAt) } },
              {
                createdAt: new Date(cursor.createdAt),
                id: { lt: cursor.id },
              },
            ],
          }
        : {}),
    };

    const messages = await this.prisma.message.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        sender: { select: { id: true, name: true, username: true, avatarUrl: true } },
        reads: { select: { userId: true, readAt: true } },
      },
    });

    const hasMore = messages.length > limit;
    const page = hasMore ? messages.slice(0, limit) : messages;
    const last = page[page.length - 1];

    const nextCursor =
      hasMore && last
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null;

    // Returned newest-first (matches the DB order); the client reverses for
    // render so scroll position is stable when older pages load.
    return { items: page.map(toMessageDto), nextCursor };
  }

  async getById(messageId: string): Promise<MessageDto> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        sender: { select: { id: true, name: true, username: true, avatarUrl: true } },
        reads: { select: { userId: true, readAt: true } },
      },
    });
    if (!message) throw new NotFoundException('Message not found');
    return toMessageDto(message);
  }

  // -------------------------------------------------------------------------
  // Send (REST + WebSocket both funnel here)
  // -------------------------------------------------------------------------

  /**
   * Single source of truth for "a message was sent". Called by both the REST
   * controller and the gateway, so an offline client using the fallback
   * endpoint gets identical side effects (delivery marker, notifications,
   * real-time fan-out) as an online client.
   */
  async send(
    conversationId: string,
    senderId: string,
    dto: SendMessageDto,
  ): Promise<MessageDto> {
    const membership = await this.conversations.assertMembership(conversationId, senderId);

    const persisted = await this.prisma.message.create({
      data: {
        conversationId,
        senderId,
        content: dto.content,
      },
      include: {
        sender: { select: { id: true, name: true, username: true, avatarUrl: true } },
        reads: true,
      },
    });

    // Conversation ordering is derived from the newest message. Same
    // transaction as the insert so the sidebar can never disagree with the
    // message table.
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: persisted.createdAt },
    });

    // Sender is inherently "read up to" their own message.
    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId: senderId } },
      data: { lastReadMessageId: persisted.id, lastReadAt: persisted.createdAt },
    });

    const recipientIds = (await this.conversations.getMemberIds(conversationId)).filter(
      (id) => id !== senderId,
    );

    let deliveredAt: Date | null = null;

    if (membership.conversation.type === ConversationType.DIRECT && recipientIds.length === 1) {
      const recipientOnline = await this.presence.isOnline(recipientIds[0]!);
      if (recipientOnline) {
        deliveredAt = new Date();
        await this.prisma.message.update({
          where: { id: persisted.id },
          data: { deliveredAt },
        });
      }
    }

    const dtoOut: MessageDto = toMessageDto({
      ...persisted,
      deliveredAt,
    });

    // Persistence is complete — now it is safe to broadcast.
    this.emitter.emitToConversation(conversationId, WsEvents.MessageNew, dtoOut);

    await this.fanOutNotifications(
      conversationId,
      senderId,
      recipientIds,
      dtoOut,
      membership.conversation.type,
      dto.content,
    );

    return dtoOut;
  }

  private async fanOutNotifications(
    conversationId: string,
    senderId: string,
    recipientIds: string[],
    message: MessageDto,
    conversationType: ConversationType,
    content: string,
  ): Promise<void> {
    if (recipientIds.length === 0) return;

    const sender = message.sender;
    const mentionHandles = this.extractMentionHandles(content);

    // Mentions are only meaningful in groups and only resolve against actual
    // members — never against arbitrary users.
    const mentionTargets =
      conversationType === ConversationType.GROUP && mentionHandles.length > 0
        ? await this.resolveMentionTargets(conversationId, recipientIds, mentionHandles)
        : new Set<string>();

    const onlineByUser = await this.presence.filterOnline(recipientIds);

    // Notification policy:
    //  - DIRECT: always notify the single recipient.
    //  - GROUP: notify mentioned users, and non-mentioned users only if offline
    //    (this is the difference between a chat app and a firehose).
    const targetUserIds = recipientIds.filter((id) => {
      if (mentionTargets.has(id)) return true;
      if (conversationType === ConversationType.DIRECT) return true;
      return !onlineByUser.has(id);
    });

    if (targetUserIds.length === 0) return;

    const conversationLabel =
      conversationType === ConversationType.DIRECT ? sender.name : 'a group';

    const title =
      conversationType === ConversationType.DIRECT
        ? sender.name
        : (await this.getConversationName(conversationId)) ?? 'Group';

    const body = content.length > 140 ? `${content.slice(0, 140)}…` : content;

    const notifications = await this.notifications.createMany(
      targetUserIds.map((userId) => ({
        userId,
        type: mentionTargets.has(userId)
          ? NotificationType.MENTION
          : NotificationType.NEW_MESSAGE,
        title,
        body:
          mentionTargets.has(userId) && conversationType !== ConversationType.DIRECT
            ? `${sender.name} mentioned you: ${body}`
            : body,
        data: {
          conversationId,
          messageId: message.id,
          senderId,
          senderName: sender.name,
          conversationLabel,
        },
      })),
    );

    for (const notification of notifications) {
      this.emitter.emitToUser(notification.userId, WsEvents.NotificationNew, notification);
    }
  }

  private extractMentionHandles(content: string): string[] {
    const matches = content.match(/@([a-zA-Z0-9_]{3,30})/g);
    if (!matches) return [];
    return Array.from(
      new Set(matches.slice(0, MAX_MENTIONS_PER_MESSAGE).map((m) => m.slice(1).toLowerCase())),
    );
  }

  private async resolveMentionTargets(
    conversationId: string,
    memberIds: string[],
    handles: string[],
  ): Promise<Set<string>> {
    const rows = await this.prisma.conversationMember.findMany({
      where: {
        conversationId,
        userId: { in: memberIds },
        user: { username: { in: handles } },
      },
      select: { userId: true },
    });
    return new Set(rows.map((r) => r.userId));
  }

  private async getConversationName(conversationId: string): Promise<string | null> {
    const c = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { name: true },
    });
    return c?.name ?? null;
  }

  // -------------------------------------------------------------------------
  // Edit / delete
  // -------------------------------------------------------------------------

  async update(messageId: string, userId: string, dto: UpdateMessageDto): Promise<MessageDto> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) throw new NotFoundException('Message not found');
    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only edit your own messages');
    }
    if (message.deletedAt) {
      throw new ForbiddenException('Deleted messages cannot be edited');
    }
    if (Date.now() - message.createdAt.getTime() > MAX_EDIT_WINDOW_MS) {
      throw new ForbiddenException('Messages can only be edited within 15 minutes of sending');
    }

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { content: dto.content, editedAt: new Date() },
      include: {
        sender: { select: { id: true, name: true, username: true, avatarUrl: true } },
        reads: { select: { userId: true, readAt: true } },
      },
    });

    const dtoOut = toMessageDto(updated);
    this.emitter.emitToConversation(message.conversationId, WsEvents.MessageUpdated, dtoOut);
    return dtoOut;
  }

  async delete(messageId: string, userId: string): Promise<void> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: { select: { id: true, type: true } } },
    });
    if (!message) throw new NotFoundException('Message not found');
    if (message.deletedAt) return; // idempotent

    if (message.senderId !== userId) {
      const membership = await this.prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId: message.conversationId, userId } },
        select: { role: true },
      });

      const isModerator =
        membership &&
        message.conversation.type === ConversationType.GROUP &&
        (membership.role === MemberRole.OWNER || membership.role === MemberRole.ADMIN);

      if (!isModerator) {
        throw new ForbiddenException('You can only delete your own messages');
      }
    }

    await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), content: '' },
    });

    this.emitter.emitToConversation(message.conversationId, WsEvents.MessageDeleted, {
      id: messageId,
      conversationId: message.conversationId,
    });
  }

  // -------------------------------------------------------------------------
  // Read receipts
  // -------------------------------------------------------------------------

  /**
   * Per-message read rows are written for DIRECT conversations only.
   * In a 50-member group the write amplification is quadratic for a feature
   * nobody consumes at that scale; groups rely on `lastReadMessageId`.
   */
  async recordDirectRead(messageId: string, userId: string): Promise<void> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: { select: { type: true } } },
    });
    if (!message) throw new NotFoundException('Message not found');
    if (message.conversation.type !== ConversationType.DIRECT) return;
    if (message.senderId === userId) return;

    await this.prisma.messageRead.upsert({
      where: { messageId_userId: { messageId, userId } },
      create: { messageId, userId },
      update: {},
    });
  }

  async unreadCount(conversationId: string, userId: string): Promise<number> {
    const membership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { lastReadAt: true },
    });
    if (!membership) throw new NotFoundException('Conversation not found');

    return this.prisma.message.count({
      where: {
        conversationId,
        senderId: { not: userId },
        deletedAt: null,
        ...(membership.lastReadAt ? { createdAt: { gt: membership.lastReadAt } } : {}),
      },
    });
  }
}