/**
 * Every WebSocket event name in one place. Imported by the gateway, the
 * emitter, and (via the shared package) the frontend client — so a typo
 * becomes a compile error rather than a silent no-op.
 */
export const WsEvents = {
  // ---- server -> client -----------------------------------------------
  MessageNew: 'message:new',
  MessageUpdated: 'message:updated',
  MessageDeleted: 'message:deleted',
  MessageRead: 'message:read',

  TypingStart: 'typing:start',
  TypingStop: 'typing:stop',

  PresenceUpdate: 'presence:update',
  PresenceUserOnline: 'presence:user-online',
  PresenceUserOffline: 'presence:user-offline',

  NotificationNew: 'notification:new',
  NotificationRead: 'notification:read',

  // ---- client -> server -----------------------------------------------
  MessageSend: 'message:send',
  MessageReadSubmit: 'message:read',
  TypingStartSubmit: 'typing:start',
  TypingStopSubmit: 'typing:stop',
  ConversationJoin: 'conversation:join',

  // ---- misc ------------------------------------------------------------
  Error: 'error',
} as const;

export type WsEvent = (typeof WsEvents)[keyof typeof WsEvents];