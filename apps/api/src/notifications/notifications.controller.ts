import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications (newest first)' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListNotificationsDto) {
    return this.notifications.list(user.id, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread notification badge count' })
  async unreadCount(@CurrentUser() user: AuthenticatedUser) {
    const count = await this.notifications.unreadCount(user.id);
    return { count };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a single notification as read' })
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notifications.markRead(id, user.id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark every unread notification as read' })
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user.id);
  }
}