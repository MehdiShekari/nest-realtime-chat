import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MarkReadDto {
  @ApiProperty()
  @IsString()
  messageId!: string;
}