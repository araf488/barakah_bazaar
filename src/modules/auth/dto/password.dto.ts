import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsExactlyOneOf } from '../../../common/validators/exactly-one-of.validator';
import { AuthConstants } from '../auth.constants';

/** `POST /auth/forgot-password`'s request body. */
export class ForgotPasswordDto {
  @ApiProperty({ example: 'shopper@example.com' })
  @IsEmail()
  email!: string;
}

/** What every non-error `POST /auth/forgot-password` answers with. Identical in every case. */
export class ForgotPasswordAcceptedDto {
  @ApiProperty({ example: 'reset_requested' })
  status!: string;
}

/**
 * `POST /auth/reset-password`'s request body: a link token alone, or an email paired with a
 * typed-in code, plus the new password.
 *
 * `IsExactlyOneOf` sits on `newPassword`, which is always required and carries no
 * `@IsOptional()`. So it runs on every request and rejects "neither" as well as "both". On
 * `token` it would be skipped whenever `token` is absent, which is the gap `VerifyEmailDto`
 * documents.
 */
export class ResetPasswordDto {
  @ApiPropertyOptional({ description: 'The token from the reset link.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(AuthConstants.PasswordResetTokenMaxLength)
  token?: string;

  @ApiPropertyOptional({ description: 'The address the code was sent to. Required with a code.' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: '6-digit code from the reset email.' })
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit numeric code' })
  code?: string;

  @ApiProperty({
    minLength: AuthConstants.PasswordMinLength,
    maxLength: AuthConstants.PasswordMaxLength,
  })
  @IsString()
  @MinLength(AuthConstants.PasswordMinLength)
  @MaxLength(AuthConstants.PasswordMaxLength)
  @IsExactlyOneOf(['token', 'code'])
  newPassword!: string;
}

/** What `POST /auth/reset-password` returns. Deliberately nothing that could act as a session. */
export class ResetPasswordResponseDto {
  @ApiProperty({ example: true })
  passwordReset!: boolean;
}

/**
 * `PATCH /auth/password`'s request body.
 *
 * `currentPassword` is bounded but not policy-checked. It was accepted when it was set, and
 * refusing to verify it because a later rule would reject it would lock its owner out of
 * changing it, which is exactly what they are trying to do.
 */
export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(AuthConstants.PasswordMaxLength)
  currentPassword!: string;

  @ApiProperty({
    minLength: AuthConstants.PasswordMinLength,
    maxLength: AuthConstants.PasswordMaxLength,
  })
  @IsString()
  @MinLength(AuthConstants.PasswordMinLength)
  @MaxLength(AuthConstants.PasswordMaxLength)
  newPassword!: string;
}
