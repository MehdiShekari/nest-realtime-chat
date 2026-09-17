import { IsOptional, IsString, Length } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateConversationDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 80 })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;
}