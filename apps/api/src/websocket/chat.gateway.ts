import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { WsEvents } from '../common/realtime/ws-events';
import { conversationRoom, userRoom } from '../common/realtime/rooms';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { PresenceService } from '../presence/presence.service';
import { SendMessageDto } from '../messages/dto/send-message.dto';
import { SocketServerProvider } from './realtime/socket-server.provider';
import { WsAuthService } from './ws-auth.service';

interface AuthenticatedSocket extends Socket {
  data: {
    user: AuthenticatedUser;
  };
}

interface MessageSendPayload {
  conversationId: string;
  content: string;
  clientId?: string;
}

interface TypingPayload {
  conversationId: string;
}

interface ReadPayload {
  conversationId: string;
  messageId: string;
}

@WebSocketGateway({
  cors: {
    // Overridden by RedisIoAdapter#createIOServer, which reads WEB_ORIGIN.
    origin: true,
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 1e6,
})
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => new WsException(errors),
  }),
)
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly serverProvider: SocketServerProvider,
    private readonly auth: WsAuthService,
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
    private readonly presence: PresenceService,
  ) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  afterInit(server: Server): void {
    this.serverProvider.setServer(server);
    this.logger.log('ChatGateway initialised');
  }

  async handleConnection(socket: AuthenticatedSocket): Promise<void> {
    try {
      const token = this.extractToken(socket);
      const user = await this.auth.authenticate(token);

      socket.data.user = user;

      // Personal room receives notifications and presence pushes.
      await socket.join(userRoom(user.id));

      // Rehydrate membership so group broadcasts reach this socket from the
      // moment it connects, without waiting for the client to ask.
      const memberships = await this.conversations['prisma'].conversationMember.findMany({
        where: { userId: user.id },
        select: { conversationId: true },
      });

      await Promise.all(
        memberships.map((m) => socket.join(conversationRoom(m.conversationId))),
      );

      const transitionedOnline = await this.presence.registerSocket(user.id, socket.id);

      this.logger.log(
        `Socket ${socket.id} connected (user=${user.id}, online transition=${transitionedOnline})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication failed';
      this.logger.warn(`Socket ${socket.id} rejected: ${message}`);
      socket.emit(WsEvents.Error, { code: 'UNAUTHENTICATED', message });
      socket.disconnect(true);
    }
  }

  async handleDisconnect(socket: AuthenticatedSocket): Promise<void> {
    const user = socket.data.user;
    if (!user) return;

    await this.presence.unregisterSocket(user.id, socket.id);
    this.logger.log(`Socket ${socket.id} disconnected (user=${user.id})`);
  }

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------

  @SubscribeMessage(WsEvents.MessageSend)
  async onMessageSend(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: MessageSendPayload,
  ) {
    const user = this.requireUser(socket);

    // Validated by the DTO — using a plain object literal so the ValidationPipe
    // transforms it in place. If the pipe rejects, the client gets an 'error'
    // event through WsException and nothing reaches the service.
    const dto: SendMessageDto = {
      content: payload.content,
      clientId: payload.clientId,
    };

    try {
      // `MessagesService.send` performs membership checks, persists, then
      // broadcasts. We must not emit anything before it returns.
      const message = await this.messages.send(payload.conversationId, user.id, dto);

      // Ack callback so the sender can reconcile the optimistic bubble.
      return { ok: true, message, clientId: payload.clientId ?? null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send message';
      this.logger.warn(`message:send failed for user=${user.id}: ${message}`);
      throw new WsException({ code: 'MESSAGE_SEND_FAILED', message });
    }
  }

  // -------------------------------------------------------------------------
  // Typing indicators — transient, never persisted
  // -------------------------------------------------------------------------

  @SubscribeMessage(WsEvents.TypingStartSubmit)
  async onTypingStart(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: TypingPayload,
  ): Promise<void> {
    const user = this.requireUser(socket);

    // Membership is verified on every keystroke burst. It is a single
    // indexed lookup and prevents unauthenticated typing spam into rooms
    // the caller does not belong to.
    await this.conversations.assertMembership(payload.conversationId, user.id);

    socket.to(conversationRoom(payload.conversationId)).emit(WsEvents.TypingStart, {
      conversationId: payload.conversationId,
      userId: user.id,
      username: user.username,
      name: user.name,
    });
  }

  @SubscribeMessage(WsEvents.TypingStopSubmit)
  async onTypingStop(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: TypingPayload,
  ): Promise<void> {
    const user = this.requireUser(socket);
    await this.conversations.assertMembership(payload.conversationId, user.id);

    socket.to(conversationRoom(payload.conversationId)).emit(WsEvents.TypingStop, {
      conversationId: payload.conversationId,
      userId: user.id,
    });
  }

  // -------------------------------------------------------------------------
  // Read receipts
  // -------------------------------------------------------------------------

  @SubscribeMessage(WsEvents.MessageReadSubmit)
  async onMessageRead(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: ReadPayload,
  ): Promise<void> {
    const user = this.requireUser(socket);

    try {
      await this.conversations.markRead(payload.conversationId, user.id, payload.messageId);
      await this.messages.recordDirectRead(payload.messageId, user.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to record read';
      this.logger.debug(`message:read ignored for user=${user.id}: ${message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Room subscription (for conversations created after the socket connected)
  // -------------------------------------------------------------------------

  @SubscribeMessage(WsEvents.ConversationJoin)
  async onConversationJoin(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: TypingPayload,
  ): Promise<void> {
    const user = this.requireUser(socket);
    await this.conversations.assertMembership(payload.conversationId, user.id);
    await socket.join(conversationRoom(payload.conversationId));
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private extractToken(socket: Socket): unknown {
    const auth = socket.handshake.auth as Record<string, unknown> | undefined;
    if (auth && typeof auth.token === 'string') return auth.token;

    // Fallback to a Bearer header for polling transports and tooling.
    const header = socket.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice(7);
    }

    return undefined;
  }

  private requireUser(socket: AuthenticatedSocket): AuthenticatedUser {
    const user = socket.data.user;
    if (!user) {
      throw new WsException({ code: 'UNAUTHENTICATED', message: 'Socket is not authenticated' });
    }
    return user;
  }
}