import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';
import { AuthConstants } from '../auth.constants';
import { UserProfileDto } from './user-profile.dto';

export class LoginDto {
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
}

/**
 * Exactly one of `code`/`recoveryCode` must be present on the object being validated.
 *
 * Attached to `mfaToken` rather than to either credential field on purpose: `@IsOptional()` on
 * `code` or `recoveryCode` skips *every* validator on that property whenever the value it
 * guards is absent — including a cross-field check placed there — which is exactly the "neither
 * provided" case this decorator exists to catch. `mfaToken` carries no such guard, so this
 * always runs.
 */
function IsExactlyOneCredential(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isExactlyOneCredential',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          const target = args.object as { code?: unknown; recoveryCode?: unknown };
          const provided = [target.code, target.recoveryCode].filter(
            (value) => value !== undefined && value !== null && value !== '',
          );
          return provided.length === 1;
        },
        defaultMessage(): string {
          return 'Provide exactly one of code or recoveryCode';
        },
      },
    });
  };
}

export class MfaVerifyDto {
  @ApiProperty({ description: 'The intermediate token returned by POST /auth/login.' })
  @IsString()
  @IsNotEmpty()
  @IsExactlyOneCredential({ message: 'Provide exactly one of code or recoveryCode' })
  mfaToken!: string;

  @ApiPropertyOptional({ description: '6-digit code from the authenticator app.' })
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit numeric code' })
  code?: string;

  @ApiPropertyOptional({
    description: 'A one-time recovery code, used when the authenticator app is unavailable.',
  })
  @IsOptional()
  @IsString()
  recoveryCode?: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

/**
 * What `POST /auth/login`, `POST /auth/login/mfa` and `POST /auth/refresh` return.
 *
 * Exactly one group of fields is populated per `kind`: `session` carries the token quartet,
 * `portal` and `user`; `mfa` carries only `mfaToken`; `enrolment` carries only `enrolmentToken`.
 *
 * Client contract for `refreshToken`: persist only a token that came from a rotation. A token
 * this response merely echoes back — which happens only from `POST /auth/refresh` inside the
 * short reuse-grace window after a concurrent refresh — must not be persisted over a token the
 * client already holds, or the client signs itself out at its next refresh. See
 * `SessionService.refresh`.
 */
export class LoginResponseDto {
  @ApiProperty({ enum: ['session', 'mfa', 'enrolment'] })
  kind!: 'session' | 'mfa' | 'enrolment';

  @ApiPropertyOptional()
  accessToken?: string;

  @ApiPropertyOptional()
  expiresAt?: Date;

  @ApiPropertyOptional()
  refreshToken?: string;

  @ApiPropertyOptional()
  refreshExpiresAt?: Date;

  @ApiPropertyOptional({ enum: ['ADMIN', 'STOREFRONT'] })
  portal?: 'ADMIN' | 'STOREFRONT';

  @ApiPropertyOptional({ type: UserProfileDto })
  user?: UserProfileDto;

  @ApiPropertyOptional({ description: 'Present only when kind is "mfa".' })
  mfaToken?: string;

  @ApiPropertyOptional({ description: 'Present only when kind is "enrolment".' })
  enrolmentToken?: string;
}
