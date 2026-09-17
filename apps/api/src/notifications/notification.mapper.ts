import type { Notification } from '@prisma/client';

export interface NotificationDto {
  id: string;
  userId: string;
  type: Notification['type'];
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export function toNotificationDto(n: Notification): NotificationDto {
  return {
    id: n.id,
    userId: n.userId,
    type: n.type,
    title: n.title,
    body: n.body,
    data: (n.data as Record<string, unknown> | null) ?? null,
    isRead: n.isRead,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}