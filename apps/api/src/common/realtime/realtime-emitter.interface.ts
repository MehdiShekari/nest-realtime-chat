export const REALTIME_EMITTER = Symbol('REALTIME_EMITTER');

/**
 * The single seam between the domain layer and Socket.IO.
 *
 * Domain services depend on this interface, never on `Server` directly.
 * That keeps them synchronous, unit-testable (swap in a spy), and free of
 * any knowledge about rooms, adapters, or Redis pub/sub.
 */
export interface RealtimeEmitter {
  emitToUser(userId: string, event: string, payload: unknown): void;
  emitToConversation(conversationId: string, event: string, payload: unknown): void;
  /** Broadcast to a conversation room, skipping one socket (typing echoes). */
  emitToConversationExcept(
    conversationId: string,
    excludedSocketId: string,
    event: string,
    payload: unknown,
  ): void;
}