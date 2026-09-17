import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';

@Module({
  imports: [UsersModule],
  controllers: [PresenceController],
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}