import { Injectable } from '@nestjs/common';
import { conversationRoom, userRoom } from '../../common/realtime/rooms';
import type { RealtimeEmitter } from '../../common/realtime/realtime-emitter.interface';
import { SocketServerProvider } from './socket-server.provider';

@Injectable()
export class SocketRealtimeEmitter implements RealtimeEmitter {
  constructor(private readonly provider: SocketServerProvider) {}

  emitToUser(userId: string, event: string, payload: unknown): void {
    if (!this.provider.isReady()) return;
    this.provider.getServer().to(userRoom(userId)).emit(event, payload);
  }

  emitToConversation(conversationId: string, event: string, payload: unknown): void {
    if (!this.provider.isReady()) return;
    this.provider.getServer().to(conversationRoom(conversationId)).emit(event, payload);
  }

  emitToConversationExcept(
    conversationId: string,
    excludedSocketId: string,
    event: string,
    payload: unknown,
  ): void {
    if (!this.provider.isReady()) return;
    this.provider
      .getServer()
      .to(conversationRoom(conversationId))
      .except(excludedSocketId)
      .emit(event, payload);
  }
}