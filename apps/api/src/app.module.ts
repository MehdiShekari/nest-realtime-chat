import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ConfigModule } from './config/config.module';
import { ConversationsModule } from './conversations/conversations.module';
import { MessagesModule } from './messages/messages.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PresenceModule } from './presence/presence.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { SearchModule } from './search/search.module';
import { UsersModule } from './users/users.module';
import { RealtimeModule } from './websocket/realtime/realtime.module';
import { WebsocketModule } from './websocket/websocket.module';

@Module({
  imports: [
    // Infrastructure
    ConfigModule,
    PrismaModule,
    RedisModule,
    RealtimeModule, // exposes REALTIME_EMITTER globally

    // Cross-cutting
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),

    // Domain
    UsersModule,
    AuthModule,
    ConversationsModule,
    NotificationsModule, // before MessagesModule — MessagesModule fans out through it
    PresenceModule,
    MessagesModule,
    SearchModule,

    // Transport
    WebsocketModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}