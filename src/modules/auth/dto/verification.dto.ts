import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { IsExactlyOneOf } from '../../../common/validators/exactly-one-of.validator';
import { AuthConstants } from '../auth.constants';

/**
 * `POST /auth/verify-email`'s request body: a link token alone, or an email paired with a
 * typed-in code.
 *
 * `IsExactlyOneOf` on `token` rejects the "both a token and a code were sent" shape. It does
 * not by itself reject "neither was sent" — `token` carries `@IsOptional()` too, which skips
 * every validator on the same property once the value is absent, this one included. That case
 * is not left unchecked: `EmailVerificationService.verify` falls through to the identical
 * `VerificationInvalid` 400 when neither a token nor an email+code pair was given.
 */
export class VerifyEmailDto {
  @ApiPropertyOptional({ description: 'The token from the verification link.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(AuthConstants.EmailVerificationTokenMaxLength)
  @IsExactlyOneOf(['token', 'code'], { message: 'Provide exactly one of token or code' })
  token?: string;

  @ApiPropertyOptional({ description: 'The address the code was sent to. Required with a code.' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: '6-digit code from the verification email.' })
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit numeric code' })
  code?: string;
}

/** What `POST /auth/verify-email` returns on success. */
export class VerifyEmailResponseDto {
  @ApiProperty({ example: true })
  emailVerified!: boolean;
}

/** `POST /auth/resend-verification`'s request body. */
export class ResendVerificationDto {
  @ApiProperty({ example: 'shopper@example.com' })
  @IsEmail()
  email!: string;
}
