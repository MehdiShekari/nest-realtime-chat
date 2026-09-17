import type {
  Conversation,
  ConversationMember,
  Message,
  User,
} from '@prisma/client';
import type { PublicUser } from '../users/user.select';

export type MemberWithUser = ConversationMember & {
  user: Pick<User, 'id' | 'name' | 'username' | 'avatarUrl' | 'status' | 'lastSeenAt'>;
};

export interface ConversationDto {
  id: string;
  type: 'DIRECT' | 'GROUP';
  name: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  members: MemberDto[];
  lastMessage: MessagePreviewDto | null;
  unreadCount: number;
  displayName: string;
  displayAvatarUrl: string | null;
}

export interface MemberDto {
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  joinedAt: string;
  user: PublicUser;
}

export interface MessagePreviewDto {
  id: string;
  senderId: string;
  content: string;
  createdAt: string;
  deletedAt: string | null;
}

const MAX_PREVIEW_CHARS = 140;

/**
 * `displayName` / `displayAvatarUrl` collapse the DIRECT-vs-GROUP branching
 * into a single field the UI can render without inspecting `type`.
 */
export function toConversationDto(
  conversation: Conversation & {
    members: MemberWithUser[];
    messages: Message[];
  },
  viewerId: string,
  unreadCount: number,
): ConversationDto {
  const lastMessage = conversation.messages[0] ?? null;

  const other = conversation.members.find((m) => m.userId !== viewerId)?.user ?? null;

  const displayName =
    conversation.type === 'DIRECT'
      ? (other?.name ?? 'Direct message')
      : (conversation.name ?? 'Group');

  const displayAvatarUrl =
    conversation.type === 'DIRECT' ? (other?.avatarUrl ?? null) : null;

  return {
    id: conversation.id,
    type: conversation.type,
    name: conversation.name,
    createdById: conversation.createdById,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    members: conversation.members.map((m) => ({
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
      user: {
        id: m.user.id,
        name: m.user.name,
        username: m.user.username,
        avatarUrl: m.user.avatarUrl,
        bio: null,
        status: m.user.status,
        lastSeenAt: m.user.lastSeenAt,
        createdAt: m.user.createdAt,
      } as PublicUser,
    })),
    lastMessage: lastMessage
      ? {
          id: lastMessage.id,
          senderId: lastMessage.senderId,
          content: lastMessage.deletedAt
            ? ''
            : lastMessage.content.length > MAX_PREVIEW_CHARS
              ? `${lastMessage.content.slice(0, MAX_PREVIEW_CHARS)}…`
              : lastMessage.content,
          createdAt: lastMessage.createdAt.toISOString(),
          deletedAt: lastMessage.deletedAt?.toISOString() ?? null,
        }
      : null,
    unreadCount,
    displayName,
    displayAvatarUrl,
  };
}