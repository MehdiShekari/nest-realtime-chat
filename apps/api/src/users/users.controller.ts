import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PagePaginationDto } from '../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { AvatarService } from './avatar.service';
import { SearchUsersDto } from './dto/search-users.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly avatars: AvatarService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Paginated user directory' })
  async list(@Query() query: PagePaginationDto) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    // Handled inline rather than in the service because it is the only
    // plain-offset listing in the app.
    const [items, total] = await Promise.all([
      this.users['prisma'].user.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'asc' },
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
      this.users['prisma'].user.count(),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  @Get('search')
  @ApiOperation({ summary: 'Search users by name or username' })
  async search(@Query() query: SearchUsersDto, @CurrentUser() current: AuthenticatedUser) {
    const { q, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    // ILIKE over the two user-facing columns. A pg_trgm GIN index would turn
    // this into an index scan; for the scale of this project the sequential
    // scan over a few thousand rows is well under a millisecond.
    const where = {
      AND: [
        { id: { not: current.id } },
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

  @Get(':id')
  @ApiOperation({ summary: 'Public profile for a user' })
  async getById(@Param('id') id: string) {
    const user = await this.users.findPublicById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update the current user profile' })
  async updateMe(@CurrentUser() current: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(current.id, dto);
  }

  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Upload or replace the current user avatar' })
  async uploadAvatar(
    @CurrentUser() current: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    const origin = `${req.protocol}://${req.get('host') ?? 'localhost'}`;
    const stored = await this.avatars.store(file, origin);
    return this.users.updateProfile(current.id, { avatarUrl: stored.url });
  }
}