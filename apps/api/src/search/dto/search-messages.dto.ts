import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';
import { PagePaginationDto } from '../../common/dto/pagination.dto';

export class SearchMessagesDto extends PagePaginationDto {
  @IsString()
  @Length(2, 100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q!: string;

  @IsOptional()
  @IsString()
  conversationId?: string;
}