import type { Message, MessageRead, User } from '@prisma/client';

export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  deliveredAt: string | null;
  sender: {
    id: string;
    name: string;
    username: string;
    avatarUrl: string | null;
  };
  reads: Array<{ userId: string; readAt: string }>;
}

type MessageWithRelations = Message & {
  sender: Pick<User, 'id' | 'name' | 'username' | 'avatarUrl'>;
  reads?: MessageRead[];
};

export function toMessageDto(message: MessageWithRelations): MessageDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    // Deleted messages keep their row (for pagination continuity) but never
    // leak their original content to clients.
    content: message.deletedAt ? '' : message.content,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    deletedAt: message.deletedAt?.toISOString() ?? null,
    deliveredAt: message.deliveredAt?.toISOString() ?? null,
    sender: {
      id: message.sender.id,
      name: message.sender.name,
      username: message.sender.username,
      avatarUrl: message.sender.avatarUrl,
    },
    reads: (message.reads ?? []).map((r) => ({
      userId: r.userId,
      readAt: r.readAt.toISOString(),
    })),
  };
}