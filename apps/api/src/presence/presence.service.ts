import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { UserStatus } from '@prisma/client';
import { WsEvents } from '../common/realtime/ws-events';
import {
  REALTIME_EMITTER,
  type RealtimeEmitter,
} from '../common/realtime/realtime-emitter.interface';
import { conversationRoom } from '../common/realtime/rooms';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { UsersService } from '../users/users.service';

const SOCKETS_KEY = (userId: string) => `presence:sockets:${userId}`;
const SOCKETS_TTL_SECONDS = 60 * 60 * 24;

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    @Inject(REALTIME_EMITTER) private readonly emitter: RealtimeEmitter,
  ) {}

  // -------------------------------------------------------------------------
  // Socket lifecycle — the multi-tab correctness lives here
  // -------------------------------------------------------------------------

  /**
   * Registers one socket for a user. Returns `true` if this connection
   * transitioned the user from offline to online (i.e. it was the first
   * socket). Closing a tab that returns `false` must not flip the user to
   * offline.
   */
  async registerSocket(userId: string, socketId: string): Promise<boolean> {
    const key = SOCKETS_KEY(userId);

    await this.redis
      .multi()
      .sadd(key, socketId)
      .expire(key, SOCKETS_TTL_SECONDS)
      .exec();

    const count = await this.redis.scard(key);

    if (count === 1) {
      await this.users.touchLastSeen(userId, UserStatus.ONLINE);
      await this.broadcastPresence(userId, 'ONLINE');
      this.logger.log(`User ${userId} is now ONLINE`);
      return true;
    }

    return false;
  }

  async unregisterSocket(userId: string, socketId: string): Promise<boolean> {
    const key = SOCKETS_KEY(userId);

    await this.redis.srem(key, socketId);
    const count = await this.redis.scard(key);

    if (count === 0) {
      await this.redis.del(key);
      await this.users.touchLastSeen(userId, UserStatus.OFFLINE);
      await this.broadcastPresence(userId, 'OFFLINE');
      this.logger.log(`User ${userId} is now OFFLINE`);
      return true;
    }

    return false;
  }

  async setAway(userId: string): Promise<void> {
    await this.users.touchLastSeen(userId, UserStatus.AWAY);
    await this.broadcastPresence(userId, 'AWAY');
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async isOnline(userId: string): Promise<boolean> {
    const count = await this.redis.scard(SOCKETS_KEY(userId));
    return count > 0;
  }

  /** Single round-trip batch check used by the notification fan-out. */
  async filterOnline(userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();

    const pipeline = this.redis.pipeline();
    for (const id of userIds) pipeline.scard(SOCKETS_KEY(id));

    const results = await pipeline.exec();
    const online = new Set<string>();

    results?.forEach(([err, value], index) => {
      if (!err && typeof value === 'number' && value > 0) {
        online.add(userIds[index]!);
      }
    });

    return online;
  }

  // -------------------------------------------------------------------------
  // Broadcast
  // -------------------------------------------------------------------------

  /**
   * Fan presence out to every conversation the user belongs to. Sockets
   * already sit in those rooms, so a single emit per room reaches all of the
   * user's contacts without enumerating them.
   */
  private async broadcastPresence(userId: string, status: 'ONLINE' | 'OFFLINE' | 'AWAY'): Promise<void> {
    const memberships = await this.prisma.conversationMember.findMany({
      where: { userId },
      select: { conversationId: true },
    });

    const event =
      status === 'ONLINE'
        ? WsEvents.PresenceUserOnline
        : status === 'OFFLINE'
          ? WsEvents.PresenceUserOffline
          : WsEvents.PresenceUpdate;

    const payload = {
      userId,
      status,
      lastSeenAt: status === 'OFFLINE' ? new Date().toISOString() : null,
    };

    for (const { conversationId } of memberships) {
      this.emitter.emitToConversation(conversationId, event, payload);
    }

    // A user's own other tabs also need to know the transition.
    this.emitter.emitToUser(userId, WsEvents.PresenceUpdate, payload);
  }

  /** Raw room name re-export so callers do not have to import from rooms.ts. */
  static roomFor(conversationId: string): string {
    return conversationRoom(conversationId);
  }
}