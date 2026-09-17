import { ConversationType } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, Length, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateConversationDto {
  @ApiProperty({ enum: ConversationType })
  @IsEnum(ConversationType)
  type!: ConversationType;

  @ApiPropertyOptional({ description: 'Required when type = DIRECT' })
  @ValidateIf((o: CreateConversationDto) => o.type === ConversationType.DIRECT)
  @IsString()
  participantId?: string;

  @ApiPropertyOptional({ description: 'Required when type = GROUP' })
  @ValidateIf((o: CreateConversationDto) => o.type === ConversationType.GROUP)
  @IsString()
  @Length(1, 80)
  name?: string;

  @ApiPropertyOptional({ description: 'Required when type = GROUP', type: [String] })
  @ValidateIf((o: CreateConversationDto) => o.type === ConversationType.GROUP)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @IsOptional()
  memberIds?: string[];
}