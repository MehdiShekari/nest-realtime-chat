import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class ListNotificationsDto extends CursorPaginationDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unreadOnly?: boolean;
}