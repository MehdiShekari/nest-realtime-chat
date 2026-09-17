import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { WsEvents } from '../common/realtime/ws-events';
import {
  REALTIME_EMITTER,
  type RealtimeEmitter,
} from '../common/realtime/realtime-emitter.interface';
import { decodeCursor, encodeCursor } from '../common/utils/cursor.util';
import { PrismaService } from '../prisma/prisma.service';
import { toNotificationDto, type NotificationDto } from './notification.mapper';
import type { ListNotificationsDto } from './dto/list-notifications.dto';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REALTIME_EMITTER) private readonly emitter: RealtimeEmitter,
  ) {}

  async list(userId: string, query: ListNotificationsDto) {
    const limit = query.limit ?? 30;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unreadOnly ? { isRead: false } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.createdAt) } },
              { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map(toNotificationDto),
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, isRead: false } });
  }

  async markRead(notificationId: string, userId: string): Promise<NotificationDto> {
    const existing = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      select: { userId: true, isRead: true },
    });

    if (!existing) throw new NotFoundException('Notification not found');
    if (existing.userId !== userId) {
      throw new ForbiddenException('You cannot modify another user notification');
    }

    if (existing.isRead) {
      const current = await this.prisma.notification.findUniqueOrThrow({
        where: { id: notificationId },
      });
      return toNotificationDto(current);
    }

    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true, readAt: new Date() },
    });

    const dto = toNotificationDto(updated);
    this.emitter.emitToUser(userId, WsEvents.NotificationRead, { id: notificationId });
    return dto;
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    this.emitter.emitToUser(userId, WsEvents.NotificationRead, { all: true });
    return { updated: result.count };
  }

  /**
   * Persists one notification per recipient in a single transaction, then
   * returns the created rows so the caller can emit them individually.
   * Using createMany here would be faster but would swallow the ids.
   */
  async createMany(inputs: CreateNotificationInput[]): Promise<NotificationDto[]> {
    if (inputs.length === 0) return [];

    const rows = await this.prisma.$transaction(
      inputs.map((input) =>
        this.prisma.notification.create({
          data: {
            userId: input.userId,
            type: input.type,
            title: input.title,
            body: input.body,
            data: (input.data ?? {}) as Prisma.InputJsonValue,
          },
        }),
      ),
    );

    this.logger.debug(`Created ${rows.length} notification(s)`);
    return rows.map(toNotificationDto);
  }

  async create(input: CreateNotificationInput): Promise<NotificationDto> {
    const row = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: (input.data ?? {}) as Prisma.InputJsonValue,
      },
    });

    const dto = toNotificationDto(row);
    this.emitter.emitToUser(input.userId, WsEvents.NotificationNew, dto);
    return dto;
  }
}