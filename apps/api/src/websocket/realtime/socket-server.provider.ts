import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

/**
 * Holds the Socket.IO server instance once the gateway has initialised.
 * The gateway calls `setServer` from `afterInit`; every other consumer goes
 * through `getServer`.
 */
@Injectable()
export class SocketServerProvider {
  private readonly logger = new Logger(SocketServerProvider.name);
  private server: Server | null = null;

  setServer(server: Server): void {
    this.server = server;
    this.logger.log('Socket.IO server registered');
  }

  getServer(): Server {
    if (!this.server) {
      throw new Error('Socket.IO server has not been initialised yet');
    }
    return this.server;
  }

  isReady(): boolean {
    return this.server !== null;
  }
}