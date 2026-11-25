import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Language } from '../../../infra/prisma/prisma-client';
import { AuthConstants } from '../auth.constants';

/**
 * `POST /auth/register`'s request body — this file is the one place that endpoint's request
 * body is declared, so add fields here rather than creating a second registration DTO.
 */
export class RegisterDto {
  @ApiProperty({ example: 'customer@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    minLength: AuthConstants.PasswordMinLength,
    maxLength: AuthConstants.PasswordMaxLength,
  })
  @IsString()
  @MinLength(AuthConstants.PasswordMinLength)
  @MaxLength(AuthConstants.PasswordMaxLength)
  password!: string;

  @ApiProperty({ example: 'Aisha Rahman' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(AuthConstants.FullNameMaxLength)
  fullName!: string;

  @ApiPropertyOptional({ enum: Language })
  @IsOptional()
  @IsEnum(Language)
  preferredLanguage?: Language;
}

/** What every non-error registration and resend answers with. Identical in every case. */
export class RegistrationAcceptedDto {
  @ApiProperty({ example: 'pending_verification' })
  status!: string;
}
