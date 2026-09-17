import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { publicUserSelect } from '../users/user.select';
import type { SearchMessagesDto } from './dto/search-messages.dto';

const MAX_MESSAGE_PREVIEW = 200;

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async searchMessages(userId: string, query: SearchMessagesDto) {
    const { q, conversationId, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    // Scope is enforced at the SQL level: a user can never search messages
    // from conversations they do not belong to, even if they guess a
    // conversationId.
    const membershipFilter = {
      conversation: {
        members: { some: { userId } },
        ...(conversationId ? { id: conversationId } : {}),
      },
    };

    const where = {
      ...membershipFilter,
      deletedAt: null,
      content: { contains: q, mode: 'insensitive' as const },
    };

    const [rows, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          sender: { select: publicUserSelect },
          conversation: {
            select: { id: true, type: true, name: true },
          },
        },
      }),
      this.prisma.message.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        conversationId: row.conversationId,
        conversationName: row.conversation.name,
        conversationType: row.conversation.type,
        senderId: row.senderId,
        sender: row.sender,
        content:
          row.content.length > MAX_MESSAGE_PREVIEW
            ? `${row.content.slice(0, MAX_MESSAGE_PREVIEW)}…`
            : row.content,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}