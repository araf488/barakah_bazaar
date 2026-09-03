import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuthConstants } from '../auth.constants';
import { AuthSettingsRepository } from './auth-settings.repository';
import { AuthSettings } from '../../../infra/prisma/prisma-client';

/** Token lifetimes and identity policy, resolved from the database with validated fallbacks. */
export interface ResolvedAuthSettings {
  readonly accessTokenMinutes: number;
  readonly customerRefreshIdleMinutes: number;
  readonly customerRefreshAbsoluteMinutes: number;
  readonly staffRefreshIdleMinutes: number;
  readonly staffRefreshAbsoluteMinutes: number;
  readonly staffMfaRequired: boolean;
  readonly emailVerificationGraceHours: number;
  readonly refreshReuseGraceSeconds: number;
  readonly staffStrictIpBinding: boolean;
  readonly customerStrictIpBinding: boolean;
}

/** Mirrors the Prisma `AuthSettings` model's `@default`s exactly. */
export const AUTH_SETTINGS_DEFAULTS: ResolvedAuthSettings = Object.freeze({
  accessTokenMinutes: 30,
  customerRefreshIdleMinutes: 43200,
  customerRefreshAbsoluteMinutes: 129600,
  staffRefreshIdleMinutes: 720,
  staffRefreshAbsoluteMinutes: 10080,
  staffMfaRequired: true,
  emailVerificationGraceHours: 168,
  refreshReuseGraceSeconds: 30,
  staffStrictIpBinding: true,
  customerStrictIpBinding: false,
});

/**
 * Resolves the current auth settings, validated field by field with a short-lived cache.
 *
 * The row is edited directly in the database (there is no admin endpoint for it yet), so a
 * bad value must never be able to make the service unable to issue a token — every field
 * that fails its own check falls back to its own default rather than failing the whole read.
 */
@Injectable()
export class AuthSettingsService {
  private cached: ResolvedAuthSettings | null = null;
  private cachedAt = 0;
  private warnedMissingRow = false;

  constructor(
    private readonly repository: AuthSettingsRepository,
    @InjectPinoLogger(AuthSettingsService.name) private readonly logger: PinoLogger,
    private readonly cacheSeconds: number,
  ) {}

  /** Never throws, never rejects. Falls back to defaults field by field. */
  async current(): Promise<ResolvedAuthSettings> {
    const now = Date.now();

    if (this.cached && now - this.cachedAt < this.cacheSeconds * 1000) {
      return this.cached;
    }

    const resolved = await this.readAndValidate();
    this.cached = resolved;
    // A failed or absent read is cached for the same window as a good one, deliberately —
    // the alternative is every request in the window retrying a database that just failed,
    // which turns one outage into a hot loop of failing reads.
    this.cachedAt = now;
    return resolved;
  }

  /**
   * Wraps the whole read-and-validate path, `validate()` included, so `current()`'s "never
   * throws" guarantee is structural rather than resting on `validate()` happening to be
   * throw-free.
   */
  private async readAndValidate(): Promise<ResolvedAuthSettings> {
    try {
      const row = await this.repository.load();

      if (row === null) {
        // The repository already logged the underlying failure with the error object; this
        // is the "using defaults" half of that story, kept distinct from the absent-row case
        // below so an outage is never mistaken for an expected, empty install.
        this.logger.error('Auth settings read failed; using defaults');
        return AUTH_SETTINGS_DEFAULTS;
      }

      if (row === undefined) {
        if (!this.warnedMissingRow) {
          this.logger.warn('Auth settings row is absent; using defaults');
          this.warnedMissingRow = true;
        }
        return AUTH_SETTINGS_DEFAULTS;
      }

      return this.validate(row);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuthSettingsService.current');
      return AUTH_SETTINGS_DEFAULTS;
    }
  }

  /**
   * Validated in a fixed order: `accessTokenMinutes` first, because every idle window is then
   * checked against its *already-validated* value — a bad access-token setting must not
   * cascade into rejecting otherwise-good idle windows.
   */
  private validate(row: AuthSettings): ResolvedAuthSettings {
    const accessTokenMinutes = AuthSettingsService.pick(
      row.accessTokenMinutes,
      (value) =>
        Number.isInteger(value) &&
        value >= AuthConstants.AccessTokenMinMinutes &&
        value <= AuthConstants.AccessTokenMaxMinutes,
      AUTH_SETTINGS_DEFAULTS.accessTokenMinutes,
      'accessTokenMinutes',
      this.logger,
    );

    // Rule 2's own default can only violate "idle > access token" if a future ceiling raise
    // pushes AccessTokenMaxMinutes past today's idle defaults (720/43200) — not reachable
    // today, but `atLeast` closes it structurally rather than leaving it to arithmetic luck.
    const customerRefreshIdleMinutes = AuthSettingsService.atLeast(
      AuthSettingsService.pick(
        row.customerRefreshIdleMinutes,
        (value) => value > accessTokenMinutes,
        AUTH_SETTINGS_DEFAULTS.customerRefreshIdleMinutes,
        'customerRefreshIdleMinutes',
        this.logger,
      ),
      accessTokenMinutes + 1,
    );

    const staffRefreshIdleMinutes = AuthSettingsService.atLeast(
      AuthSettingsService.pick(
        row.staffRefreshIdleMinutes,
        (value) => value > accessTokenMinutes,
        AUTH_SETTINGS_DEFAULTS.staffRefreshIdleMinutes,
        'staffRefreshIdleMinutes',
        this.logger,
      ),
      accessTokenMinutes + 1,
    );

    // Rule 3 is checked against the *input* value inside `pick`, but a rejected input falls
    // back to a fixed default that was never re-checked against the resolved idle window
    // above — if the idle window was itself raised, that default can be shorter than it. The
    // `atLeast` clamp re-asserts the invariant on the value actually returned, not just the
    // value that was validated.
    const customerRefreshAbsoluteMinutes = AuthSettingsService.atLeast(
      AuthSettingsService.pick(
        row.customerRefreshAbsoluteMinutes,
        (value) => value >= customerRefreshIdleMinutes,
        AUTH_SETTINGS_DEFAULTS.customerRefreshAbsoluteMinutes,
        'customerRefreshAbsoluteMinutes',
        this.logger,
      ),
      customerRefreshIdleMinutes,
    );

    const staffRefreshAbsoluteMinutes = AuthSettingsService.atLeast(
      AuthSettingsService.pick(
        row.staffRefreshAbsoluteMinutes,
        (value) => value >= staffRefreshIdleMinutes,
        AUTH_SETTINGS_DEFAULTS.staffRefreshAbsoluteMinutes,
        'staffRefreshAbsoluteMinutes',
        this.logger,
      ),
      staffRefreshIdleMinutes,
    );

    const emailVerificationGraceHours = AuthSettingsService.pick(
      row.emailVerificationGraceHours,
      (value) => Number.isInteger(value) && value >= 0,
      AUTH_SETTINGS_DEFAULTS.emailVerificationGraceHours,
      'emailVerificationGraceHours',
      this.logger,
    );

    const refreshReuseGraceSeconds = AuthSettingsService.pick(
      row.refreshReuseGraceSeconds,
      (value) => Number.isInteger(value) && value >= 0,
      AUTH_SETTINGS_DEFAULTS.refreshReuseGraceSeconds,
      'refreshReuseGraceSeconds',
      this.logger,
    );

    const staffMfaRequired = AuthSettingsService.pick(
      row.staffMfaRequired,
      (value) => typeof value === 'boolean',
      AUTH_SETTINGS_DEFAULTS.staffMfaRequired,
      'staffMfaRequired',
      this.logger,
    );

    const staffStrictIpBinding = AuthSettingsService.pick(
      row.staffStrictIpBinding,
      (value) => typeof value === 'boolean',
      AUTH_SETTINGS_DEFAULTS.staffStrictIpBinding,
      'staffStrictIpBinding',
      this.logger,
    );

    const customerStrictIpBinding = AuthSettingsService.pick(
      row.customerStrictIpBinding,
      (value) => typeof value === 'boolean',
      AUTH_SETTINGS_DEFAULTS.customerStrictIpBinding,
      'customerStrictIpBinding',
      this.logger,
    );

    return {
      accessTokenMinutes,
      customerRefreshIdleMinutes,
      customerRefreshAbsoluteMinutes,
      staffRefreshIdleMinutes,
      staffRefreshAbsoluteMinutes,
      staffMfaRequired,
      emailVerificationGraceHours,
      refreshReuseGraceSeconds,
      staffStrictIpBinding,
      customerStrictIpBinding,
    };
  }

  /**
   * One field's value when it passes `isValid`, otherwise its own default — logged with the
   * field name in structured context (never interpolated into the message, S2629).
   */
  private static pick<T>(
    value: T,
    isValid: (value: T) => boolean,
    fallback: T,
    field: string,
    logger: PinoLogger,
  ): T {
    if (isValid(value)) {
      return value;
    }

    logger.error({ field, value }, 'Invalid auth setting, using default');
    return fallback;
  }

  /**
   * Re-asserts a floor on the value `pick` actually returned, whichever branch produced it.
   * `pick` only checks the *input*; a fallback default is a fixed constant that can itself
   * fall below a floor computed from another field's *resolved* value (see rule 3's comment
   * above), so this runs unconditionally rather than only on the fallback path.
   */
  private static atLeast(value: number, floor: number): number {
    return Math.max(value, floor);
  }
}
