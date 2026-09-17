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
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { ListConversationsDto } from './dto/list-conversations.dto';
import { AddMemberDto } from './dto/member-actions.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';

@ApiTags('conversations')
@ApiBearerAuth('access-token')
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @ApiOperation({ summary: 'List the current user conversations' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListConversationsDto) {
    return this.conversations.list(user.id, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a direct or group conversation' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateConversationDto) {
    return this.conversations.create(user.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a conversation the current user belongs to' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.conversations.getById(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a group conversation' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.conversations.update(id, user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a group conversation (owner only)' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.conversations.remove(id, user.id);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add a member to a group conversation' })
  addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.conversations.addMember(id, user.id, dto.userId);
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a member, or leave the group yourself' })
  async removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') targetId: string,
  ) {
    await this.conversations.removeMember(id, user.id, targetId);
  }
}