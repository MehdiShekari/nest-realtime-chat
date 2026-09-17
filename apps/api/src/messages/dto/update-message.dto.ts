import { IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateMessageDto {
  @ApiProperty({ minLength: 1, maxLength: 4000 })
  @IsString()
  @Length(1, 4000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  content!: string;
}