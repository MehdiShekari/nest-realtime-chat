import { IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class SendMessageDto {
  @ApiProperty({ minLength: 1, maxLength: 4000 })
  @IsString()
  @Length(1, 4000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  content!: string;

  /**
   * Optional client-generated correlation id. Echoed back in the ack so the
   * sender can reconcile an optimistic bubble with the persisted row.
   */
  @IsString()
  @Length(1, 64)
  clientId?: string;
}