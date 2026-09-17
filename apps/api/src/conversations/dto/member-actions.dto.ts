import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddMemberDto {
  @ApiProperty()
  @IsString()
  userId!: string;
}