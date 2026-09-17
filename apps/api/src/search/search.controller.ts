import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { SearchUsersDto } from '../users/dto/search-users.dto';
import { UsersService } from '../users/users.service';
import { SearchMessagesDto } from './dto/search-messages.dto';
import { SearchService } from './search.service';

@ApiTags('search')
@ApiBearerAuth('access-token')
@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly users: UsersService,
  ) {}

  @Get('users')
  @ApiOperation({ summary: 'Search users by name or username' })
  async searchUsers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SearchUsersDto,
  ) {
    const { q, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where = {
      AND: [
        { id: { not: user.id } },
        {
          OR: [
            { username: { contains: q, mode: 'insensitive' as const } },
            { name: { contains: q, mode: 'insensitive' as const } },
          ],
        },
      ],
    };

    const [items, total] = await Promise.all([
      this.users['prisma'].user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { username: 'asc' },
        select: {
          id: true,
          name: true,
          username: true,
          avatarUrl: true,
          bio: true,
          status: true,
          lastSeenAt: true,
          createdAt: true,
        },
      }),
      this.users['prisma'].user.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  @Get('messages')
  @ApiOperation({ summary: 'Search messages within the caller conversations' })
  searchMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SearchMessagesDto,
  ) {
    return this.search.searchMessages(user.id, query);
  }
}