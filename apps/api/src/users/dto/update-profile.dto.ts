import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUrl, Length, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';

export class UpdateProfileDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 50 })
  @IsOptional()
  @IsString()
  @Length(2, 50)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;

  @ApiPropertyOptional({ minLength: 3, maxLength: 30 })
  @IsOptional()
  @IsString()
  @Length(3, 30)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'username may only contain letters, numbers and underscores',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase().trim() : value))
  username?: string;

  @ApiPropertyOptional({ maxLength: 280 })
  @IsOptional()
  @IsString()
  @Length(0, 280)
  bio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true })
  avatarUrl?: string;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}