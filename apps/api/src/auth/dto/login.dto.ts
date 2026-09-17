import { Transform } from 'class-transformer';
import { IsString, Length, MaxLength } from 'class-validator';

export class LoginDto {
  /** Accepts either an email address or a username. */
  @IsString()
  @Length(3, 255)
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase().trim() : value))
  identifier!: string;

  @IsString()
  @Length(8, 72)
  password!: string;
}