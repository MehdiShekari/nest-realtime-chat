import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PresenceModule } from '../presence/presence.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [ConversationsModule, NotificationsModule, PresenceModule],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}