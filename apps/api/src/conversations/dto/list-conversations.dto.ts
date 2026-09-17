import { CursorPaginationDto } from '../../common/dto/pagination.dto';

/**
 * Conversation list is ordered by `lastMessageAt DESC`. The cursor encodes
 * the same `(createdAt, id)` shape used for messages, where `createdAt` is
 * the last message timestamp.
 */
export class ListConversationsDto extends CursorPaginationDto {}