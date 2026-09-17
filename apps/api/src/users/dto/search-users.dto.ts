import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';
import { PagePaginationDto } from '../../common/dto/pagination.dto';

export class SearchUsersDto extends PagePaginationDto {
  @IsString()
  @Length(1, 60)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q!: string;

  @IsOptional()
  @IsString()
  excludeSelf?: string;
}