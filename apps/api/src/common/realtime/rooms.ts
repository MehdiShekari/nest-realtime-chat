/**
 * Room naming is centralised so the gateway and the emitter can never
 * disagree about which string identifies a user or a conversation.
 */
export const userRoom = (userId: string): string => `user:${userId}`;
export const conversationRoom = (conversationId: string): string => `conversation:${conversationId}`;