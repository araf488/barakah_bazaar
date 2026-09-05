import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { AuthConstants } from '../auth.constants';

/**
 * Starting enrolment with the `enrolmentToken` that `POST /auth/login` returns to a staff
 * account which must enrol before it can sign in.
 *
 * The token is the only credential, and deliberately so: the holder has no session yet, which
 * is the whole reason this endpoint exists.
 */
export class MfaSetupDto {
  @ApiProperty({ description: 'The enrolment token returned by POST /auth/login.' })
  @IsString()
  @IsNotEmpty()
  enrolmentToken!: string;
}

/** Confirming an enrolment: the token from `setup`, plus a code from the authenticator app. */
export class MfaEnableDto {
  @ApiProperty({ description: 'The enrolment token returned by POST /auth/login.' })
  @IsString()
  @IsNotEmpty()
  enrolmentToken!: string;

  @ApiProperty({ description: '6-digit code from the authenticator app.' })
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit numeric code' })
  code!: string;
}

/**
 * Turning a second factor off. Requires the account password as well as a current code — one
 * proves the session was not merely stolen, the other that the factor is still in the caller's
 * hands. Refused outright for staff while `staffMfaRequired` is set.
 */
export class MfaDisableDto {
  @ApiProperty()
  @IsString()
  @MinLength(AuthConstants.PasswordMinLength)
  @MaxLength(AuthConstants.PasswordMaxLength)
  password!: string;

  @ApiProperty({ description: '6-digit code from the authenticator app.' })
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit numeric code' })
  code!: string;
}

/** What `POST /auth/mfa/setup` returns. The secret is shown once, at enrolment. */
export class MfaSetupResponseDto {
  @ApiProperty({ description: 'Base32 TOTP secret, for manual entry.' })
  secret!: string;

  @ApiProperty({
    description:
      'otpauth:// URI the client renders as a QR code. The server never draws it — posting a ' +
      'shared secret to a QR-image service would hand the second factor to a third party.',
  })
  otpauthUri!: string;
}

/**
 * What `POST /auth/mfa/enable` returns.
 *
 * The only time these codes are ever readable: they are stored as SHA-256 hashes, so nothing
 * can show them again.
 */
export class MfaEnableResponseDto {
  @ApiProperty({ type: [String], description: 'Ten single-use recovery codes, shown once.' })
  recoveryCodes!: string[];
}
