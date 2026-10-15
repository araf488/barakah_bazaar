import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuthSettingsRepository } from './auth-settings.repository';
import {
  AUTH_SETTINGS_DEFAULTS,
  AuthSettingsField,
  ResolvedAuthSettings,
  isFieldValid,
} from './auth-settings.rules';
import { AuthSettings } from '../../../infra/prisma/prisma-client';

export { AUTH_SETTINGS_DEFAULTS } from './auth-settings.rules';
export type { ResolvedAuthSettings } from './auth-settings.rules';

/** What one validation pass produced: the settings, and every field that fell back to its default. */
interface ValidatedAuthSettings {
  readonly settings: ResolvedAuthSettings;
  readonly fallbacks: AuthSettingsField[];
}

/** An uncached read's result, with which fields fell back and when the row was last written. */
export interface AuthSettingsWithFallbacks extends ValidatedAuthSettings {
  readonly updatedAt: Date | null;
  /**
   * The raw stored value of each field in `fallbacks`, exactly as the row held it, taken from
   * the same read. A write that heals those fields overwrites them, so this is the only place
   * the invalid values survive long enough to be audited. Empty when nothing fell back.
   */
  readonly storedFallbackValues: Partial<ResolvedAuthSettings>;
}

/**
 * Resolves the current auth settings, validated field by field with a short-lived cache.
 *
 * The row is written through `PATCH /admin/auth-settings` (which validates first) but can still
 * be edited directly in the database, so a bad value must never be able to make the service
 * unable to issue a token — every field that fails its own check falls back to its own default
 * rather than failing the whole read.
 *
 * The per-field rules live in `auth-settings.rules.ts`, shared with the write path, so what
 * a write refuses and what a read falls back from are one definition. Sharing them brought
 * two upper bounds to the read path that it did not previously enforce: a stored
 * `refreshReuseGraceSeconds` above `AuthConstants.RefreshReuseGraceMaxSeconds` (120) and a
 * stored `emailVerificationGraceHours` above `AuthConstants.EmailVerificationGraceMaxHours`
 * (720) now fall back to their defaults (30 and 168) and are logged, like any other bad field.
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
   * Drops the cached settings, so the next `current()` reads the database.
   *
   * This can race an in-flight `current()` on the same instance: a read that loaded the row just
   * before a write lands its (old) result into the cache after this runs. That staleness is still
   * bounded by `cacheSeconds` (`AUTH_SETTINGS_CACHE_SECONDS`), which is exactly what the admin
   * write's `propagatesWithinSeconds` promises, so no generation counter is kept to close it.
   */
  invalidate(): void {
    try {
      this.cached = null;
      this.cachedAt = 0;
    } catch (error) {
      // Two field resets cannot throw today; the block is the standing rule for every public
      // service method, so a future change here cannot fail an admin write that already committed.
      this.logger.error({ err: error }, 'Exception occurred in AuthSettingsService.invalidate');
    }
  }

  /**
   * An uncached read, validated exactly as `current()` validates, that also reports which
   * fields fell back to their defaults. Neither reads nor populates the cache.
   *
   * `null` when the read failed — a fault is not reported as defaults here, because a caller
   * showing the settings must not present an outage as the stored values. An absent row is
   * the defaults, with no fallbacks and no `updatedAt`.
   */
  async resolveWithFallbacks(): Promise<AuthSettingsWithFallbacks | null> {
    try {
      const row = await this.repository.load();

      if (row === null) {
        // The repository already logged the underlying failure with the error object.
        return null;
      }

      if (row === undefined) {
        return {
          settings: AUTH_SETTINGS_DEFAULTS,
          fallbacks: [],
          updatedAt: null,
          storedFallbackValues: {},
        };
      }

      const validated = this.validate(row);

      return {
        ...validated,
        updatedAt: row.updatedAt,
        storedFallbackValues: AuthSettingsService.storedValuesOf(row, validated.fallbacks),
      };
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in AuthSettingsService.resolveWithFallbacks',
      );
      return null;
    }
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

      return this.validate(row).settings;
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuthSettingsService.current');
      return AUTH_SETTINGS_DEFAULTS;
    }
  }

  /**
   * Validated in a fixed order: `accessTokenMinutes` first, because every idle window is then
   * checked against its *already-validated* value — a bad access-token setting must not
   * cascade into rejecting otherwise-good idle windows.
   *
   * The one validation both `current()` (which keeps only `settings`) and
   * `resolveWithFallbacks()` use, so the two can never disagree about which fields fell back.
   */
  private validate(row: AuthSettings): ValidatedAuthSettings {
    const fallbacks: AuthSettingsField[] = [];
    const logger = this.logger;

    const accessTokenMinutes = AuthSettingsService.pick(
      'accessTokenMinutes',
      row.accessTokenMinutes,
      {},
      fallbacks,
      logger,
    );

    // Rule 2's own default can only violate "idle > access token" if a future ceiling raise
    // pushes AccessTokenMaxMinutes past today's idle defaults (720/43200) — not reachable
    // today, but `atLeast` closes it structurally rather than leaving it to arithmetic luck.
    const customerRefreshIdleMinutes = AuthSettingsService.atLeast(
      AuthSettingsService.pick(
        'customerRefreshIdleMinutes',
        row.customerRefreshIdleMinutes,
        { accessTokenMinutes },
        fallbacks,
        logger,
      ),
      accessTokenMinutes + 1,
    );

    const staffRefreshIdleMinutes = AuthSettingsService.atLeast(
      AuthSettingsService.pick(
        'staffRefreshIdleMinutes',
        row.staffRefreshIdleMinutes,
        { accessTokenMinutes },
        fallbacks,
        logger,
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
        'customerRefreshAbsoluteMinutes',
        row.customerRefreshAbsoluteMinutes,
        { customerRefreshIdleMinutes },
        fallbacks,
        logger,
      ),
      customerRefreshIdleMinutes,
    );

    const staffRefreshAbsoluteMinutes = AuthSettingsService.atLeast(
      AuthSettingsService.pick(
        'staffRefreshAbsoluteMinutes',
        row.staffRefreshAbsoluteMinutes,
        { staffRefreshIdleMinutes },
        fallbacks,
        logger,
      ),
      staffRefreshIdleMinutes,
    );

    const emailVerificationGraceHours = AuthSettingsService.pick(
      'emailVerificationGraceHours',
      row.emailVerificationGraceHours,
      {},
      fallbacks,
      logger,
    );

    const refreshReuseGraceSeconds = AuthSettingsService.pick(
      'refreshReuseGraceSeconds',
      row.refreshReuseGraceSeconds,
      {},
      fallbacks,
      logger,
    );

    const staffMfaRequired = AuthSettingsService.pick(
      'staffMfaRequired',
      row.staffMfaRequired,
      {},
      fallbacks,
      logger,
    );

    return {
      settings: {
        accessTokenMinutes,
        customerRefreshIdleMinutes,
        customerRefreshAbsoluteMinutes,
        staffRefreshIdleMinutes,
        staffRefreshAbsoluteMinutes,
        staffMfaRequired,
        emailVerificationGraceHours,
        refreshReuseGraceSeconds,
      },
      fallbacks,
    };
  }

  /**
   * One field's value when it passes its rule in `auth-settings.rules.ts`, otherwise its own
   * default — recorded in `fallbacks` and logged with the field name in structured context
   * (never interpolated into the message, S2629).
   */
  private static pick<K extends AuthSettingsField>(
    field: K,
    value: ResolvedAuthSettings[K],
    resolved: Partial<ResolvedAuthSettings>,
    fallbacks: AuthSettingsField[],
    logger: PinoLogger,
  ): ResolvedAuthSettings[K] {
    if (isFieldValid(field, value, resolved)) {
      return value;
    }

    logger.error({ field, value }, 'Invalid auth setting, using default');
    fallbacks.push(field);
    return AUTH_SETTINGS_DEFAULTS[field];
  }
  /** The raw stored values of `fields`, read off the row the validation ran over. */
  private static storedValuesOf(
    row: AuthSettings,
    fields: readonly AuthSettingsField[],
  ): Partial<ResolvedAuthSettings> {
    return Object.fromEntries(fields.map((field) => [field, row[field]]));
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
