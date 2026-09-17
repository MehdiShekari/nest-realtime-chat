import { Prisma } from '@prisma/client';

/**
 * The single source of truth for "what a user looks like over the wire".
 * Every query returning a user to a client must use this select.
 * passwordHash is structurally impossible to leak.
 */
export const publicUserSelect = {
  id: true,
  name: true,
  username: true,
  avatarUrl: true,
  bio: true,
  status: true,
  lastSeenAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;