import {
  Body,
  Controller,
  Delete,
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
import { ConversationsService } from '../conversations/conversations.service';
import { ListMessagesDto } from './dto/list-messages.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { MessagesService } from './messages.service';

@ApiTags('messages')
@ApiBearerAuth('access-token')
@Controller()
export class MessagesController {
  constructor(
    private readonly messages: MessagesService,
    private readonly conversations: ConversationsService,
  ) {}

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Cursor-paginated message history (newest first)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') conversationId: string,
    @Query() query: ListMessagesDto,
  ) {
    return this.messages.list(conversationId, user.id, query);
  }

  @Post('conversations/:id/messages')
  @ApiOperation({ summary: 'Send a message (REST fallback for the WebSocket path)' })
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') conversationId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messages.send(conversationId, user.id, dto);
  }

  @Post('conversations/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Advance the read pointer for a conversation' })
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') conversationId: string,
    @Body() dto: MarkReadDto,
  ) {
    await this.conversations.markRead(conversationId, user.id, dto.messageId);
    await this.messages.recordDirectRead(dto.messageId, user.id);
  }

  @Get('conversations/:id/unread-count')
  @ApiOperation({ summary: 'Unread message count for one conversation' })
  async unreadCount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') conversationId: string,
  ) {
    const count = await this.messages.unreadCount(conversationId, user.id);
    return { conversationId, count };
  }

  @Patch('messages/:id')
  @ApiOperation({ summary: 'Edit a message (sender only, within 15 minutes)' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateMessageDto,
  ) {
    return this.messages.update(id, user.id, dto);
  }

  @Delete('messages/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a message (sender or group moderator)' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.messages.delete(id, user.id);
  }
}