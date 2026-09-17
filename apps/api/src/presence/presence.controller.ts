import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service';

class PresenceQueryDto {
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value,
  )
  userIds!: string[];
}

@ApiTags('presence')
@ApiBearerAuth('access-token')
@Controller('presence')
export class PresenceController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Current status for a set of user ids' })
  async get(@Query() query: PresenceQueryDto) {
    const rows = await this.prisma.user.findMany({
      where: { id: { in: query.userIds } },
      select: { id: true, status: true, lastSeenAt: true },
    });

    const map: Record<string, { status: string; lastSeenAt: string | null }> = {};
    for (const row of rows) {
      map[row.id] = {
        status: row.status,
        lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      };
    }
    return map;
  }
}