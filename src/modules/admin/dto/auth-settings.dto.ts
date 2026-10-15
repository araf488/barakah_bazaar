import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { AuthConstants } from '../../auth/auth.constants';
import { AuthSettingsField, ResolvedAuthSettings } from '../../auth/settings/auth-settings.rules';

/**
 * Validates a field when it is present, including an explicit `null`. Only an absent field
 * (`undefined`) is skipped. `@IsOptional()` would also skip `null`, which would carry it past
 * the DTO into the cross-field rules. There, a null dependency reports nonsense such as
 * "greater than accessTokenMinutes (NaN)". Rejecting it here gives a plain 400 on the field itself.
 */
const presentOrNull = (_obj: object, value: unknown): boolean => value !== undefined;

/** Token lifetimes and identity policy, as the service is currently enforcing them. */
export class AuthSettingsDto implements ResolvedAuthSettings {
  @ApiProperty({ description: 'Access-token lifetime, in minutes' })
  accessTokenMinutes!: number;

  @ApiProperty({ description: 'Customer refresh idle window, in minutes' })
  customerRefreshIdleMinutes!: number;

  @ApiProperty({ description: 'Customer refresh absolute cap, in minutes' })
  customerRefreshAbsoluteMinutes!: number;

  @ApiProperty({ description: 'Staff refresh idle window, in minutes' })
  staffRefreshIdleMinutes!: number;

  @ApiProperty({ description: 'Staff refresh absolute cap, in minutes' })
  staffRefreshAbsoluteMinutes!: number;

  @ApiProperty({ description: 'Whether staff accounts must use two-factor authentication' })
  staffMfaRequired!: boolean;

  @ApiProperty({ description: 'How long an unverified account may still sign in, in hours' })
  emailVerificationGraceHours!: number;

  @ApiProperty({ description: 'How long a rotated-away refresh token still works, in seconds' })
  refreshReuseGraceSeconds!: number;
}

/** `GET /admin/auth-settings`. */
export class AuthSettingsViewDto {
  @ApiProperty({ type: AuthSettingsDto, description: 'The effective settings' })
  settings!: ResolvedAuthSettings;

  @ApiProperty({
    type: [String],
    description: 'Fields whose stored value was invalid, so their default is in force instead',
  })
  fallbacks!: AuthSettingsField[];

  @ApiProperty({
    nullable: true,
    type: Date,
    description: 'When the settings row was last written; null when there is no row yet',
  })
  updatedAt!: Date | null;
}

/** `PATCH /admin/auth-settings`. */
export class AuthSettingsUpdatedDto {
  @ApiProperty({ type: AuthSettingsDto, description: 'The settings as written' })
  settings!: ResolvedAuthSettings;

  @ApiProperty({
    description:
      'Upper bound, in seconds, before every instance uses the new settings for new sign-ins and ' +
      'refreshes (the cache window). Sessions already issued keep their absolute deadline, so ' +
      'shortening an absolute window does not shorten them. Turning staffMfaRequired back on is ' +
      'the exception: it revokes staff sessions at once (see staffSessionsRevoked).',
  })
  propagatesWithinSeconds!: number;

  @ApiProperty({
    minimum: 0,
    description:
      'How many staff sessions this write revoked. Turning staffMfaRequired from false to true ' +
      'revokes every live session of every non-customer account, the acting super admin ' +
      "included, so each staff member's next sign-in must pass the second factor. A revoked " +
      'session is refused on its next request and its refresh token stops working; sign in ' +
      'again. 0 when the write was not that transition.',
  })
  staffSessionsRevoked!: number;
}

/**
 * A partial change to the auth settings, merged over the effective settings.
 *
 * An absent field is left alone, but an explicit `null` is refused here (see `presentOrNull`).
 * The bounds here are request-shape checks only — integers, and a ceiling so an absurd value
 * never reaches a Postgres `int4` write. The policy (the cross-field rules) runs in the service,
 * against the merged result, through the same `checkAuthSettings` the read path uses.
 */
export class UpdateAuthSettingsDto {
  @ApiPropertyOptional({
    minimum: AuthConstants.AccessTokenMinMinutes,
    maximum: AuthConstants.AccessTokenMaxMinutes,
  })
  @ValidateIf(presentOrNull)
  @IsInt()
  @Min(AuthConstants.AccessTokenMinMinutes)
  @Max(AuthConstants.AccessTokenMaxMinutes)
  accessTokenMinutes?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: AuthConstants.SettingsMinutesMax,
    description: 'Must be greater than accessTokenMinutes',
  })
  @ValidateIf(presentOrNull)
  @IsInt()
  @Min(0)
  @Max(AuthConstants.SettingsMinutesMax)
  customerRefreshIdleMinutes?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: AuthConstants.SettingsMinutesMax,
    description: 'Must be at least customerRefreshIdleMinutes',
  })
  @ValidateIf(presentOrNull)
  @IsInt()
  @Min(0)
  @Max(AuthConstants.SettingsMinutesMax)
  customerRefreshAbsoluteMinutes?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: AuthConstants.SettingsMinutesMax,
    description: 'Must be greater than accessTokenMinutes',
  })
  @ValidateIf(presentOrNull)
  @IsInt()
  @Min(0)
  @Max(AuthConstants.SettingsMinutesMax)
  staffRefreshIdleMinutes?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: AuthConstants.SettingsMinutesMax,
    description: 'Must be at least staffRefreshIdleMinutes',
  })
  @ValidateIf(presentOrNull)
  @IsInt()
  @Min(0)
  @Max(AuthConstants.SettingsMinutesMax)
  staffRefreshAbsoluteMinutes?: number;

  @ApiPropertyOptional({
    description: 'Turning this off also needs `confirmDisableStaffMfa: true`',
  })
  @ValidateIf(presentOrNull)
  @IsBoolean()
  staffMfaRequired?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: AuthConstants.EmailVerificationGraceMaxHours })
  @ValidateIf(presentOrNull)
  @IsInt()
  @Min(0)
  @Max(AuthConstants.EmailVerificationGraceMaxHours)
  emailVerificationGraceHours?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: AuthConstants.RefreshReuseGraceMaxSeconds })
  @ValidateIf(presentOrNull)
  @IsInt()
  @Min(0)
  @Max(AuthConstants.RefreshReuseGraceMaxSeconds)
  refreshReuseGraceSeconds?: number;

  @ApiPropertyOptional({
    description: 'Required, as true, to turn `staffMfaRequired` from true to false',
  })
  @IsOptional()
  @IsBoolean()
  confirmDisableStaffMfa?: boolean;
}
