import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { ServerOptions } from 'socket.io';
import { AppConfigService } from '../config/app-config.service';

/**
 * Wires the Socket.IO Redis adapter so broadcasts reach clients connected to
 * any API instance. Even in single-instance local development this keeps the
 * production topology honest — no code changes needed to scale out.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private pubClient?: Redis;
  private subClient?: Redis;

  constructor(
    app: INestApplicationContext,
    private readonly config: AppConfigService,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    this.pubClient = new Redis(this.config.redisUrl, { maxRetriesPerRequest: null });
    this.subClient = this.pubClient.duplicate();

    await Promise.all([this.pubClient.ping(), this.subClient.ping()]);

    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
    this.logger.log('Socket.IO Redis adapter connected');
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.config.webOrigin,
        credentials: true,
      },
    });

    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }

    return server;
  }

  async close(): Promise<void> {
    await Promise.all([this.pubClient?.quit(), this.subClient?.quit()]);
  }
}