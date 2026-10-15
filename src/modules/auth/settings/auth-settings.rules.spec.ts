import {
  AUTH_SETTINGS_DEFAULTS,
  ResolvedAuthSettings,
  checkAuthSettings,
  isFieldValid,
} from './auth-settings.rules';

const candidate = (overrides: Partial<Record<keyof ResolvedAuthSettings, unknown>> = {}) =>
  ({ ...AUTH_SETTINGS_DEFAULTS, ...overrides }) as ResolvedAuthSettings;

describe('auth-settings rules', () => {
  describe('checkAuthSettings', () => {
    it('accepts the defaults', () => {
      expect(checkAuthSettings(AUTH_SETTINGS_DEFAULTS)).toEqual([]);
    });

    it('refuses an access-token life below the floor', () => {
      expect(checkAuthSettings(candidate({ accessTokenMinutes: 4 }))).toEqual([
        {
          field: 'accessTokenMinutes',
          message: 'accessTokenMinutes must be a whole number from 5 to 120.',
        },
      ]);
    });

    it('refuses an access-token life above the ceiling', () => {
      expect(checkAuthSettings(candidate({ accessTokenMinutes: 121 }))).toEqual([
        {
          field: 'accessTokenMinutes',
          message: 'accessTokenMinutes must be a whole number from 5 to 120.',
        },
      ]);
    });

    it('accepts the access-token floor and ceiling themselves', () => {
      expect(checkAuthSettings(candidate({ accessTokenMinutes: 5 }))).toEqual([]);
      expect(checkAuthSettings(candidate({ accessTokenMinutes: 120 }))).toEqual([]);
    });

    it('refuses a fractional access-token life', () => {
      expect(checkAuthSettings(candidate({ accessTokenMinutes: 30.5 }))).toEqual([
        {
          field: 'accessTokenMinutes',
          message: 'accessTokenMinutes must be a whole number from 5 to 120.',
        },
      ]);
    });

    it('refuses an idle window equal to the access-token life', () => {
      expect(checkAuthSettings(candidate({ customerRefreshIdleMinutes: 30 }))).toEqual([
        {
          field: 'customerRefreshIdleMinutes',
          message: 'customerRefreshIdleMinutes must be greater than accessTokenMinutes (30).',
        },
      ]);
    });

    it('accepts an idle window one minute longer than the access-token life', () => {
      expect(
        checkAuthSettings(
          candidate({ staffRefreshIdleMinutes: 31, staffRefreshAbsoluteMinutes: 31 }),
        ),
      ).toEqual([]);
    });

    it('refuses a staff idle window equal to the access-token life', () => {
      expect(
        checkAuthSettings(
          candidate({ staffRefreshIdleMinutes: 30, staffRefreshAbsoluteMinutes: 30 }),
        ),
      ).toEqual([
        {
          field: 'staffRefreshIdleMinutes',
          message: 'staffRefreshIdleMinutes must be greater than accessTokenMinutes (30).',
        },
      ]);
    });

    it('accepts an absolute cap equal to its idle window', () => {
      expect(checkAuthSettings(candidate({ customerRefreshAbsoluteMinutes: 43200 }))).toEqual([]);
    });

    it('refuses an absolute cap one minute below its idle window', () => {
      expect(checkAuthSettings(candidate({ customerRefreshAbsoluteMinutes: 43199 }))).toEqual([
        {
          field: 'customerRefreshAbsoluteMinutes',
          message:
            'customerRefreshAbsoluteMinutes must be at least customerRefreshIdleMinutes (43200).',
        },
      ]);
    });

    it('refuses a staff absolute cap below its idle window', () => {
      expect(checkAuthSettings(candidate({ staffRefreshAbsoluteMinutes: 719 }))).toEqual([
        {
          field: 'staffRefreshAbsoluteMinutes',
          message: 'staffRefreshAbsoluteMinutes must be at least staffRefreshIdleMinutes (720).',
        },
      ]);
    });

    it('refuses a refresh reuse grace above 120 seconds', () => {
      expect(checkAuthSettings(candidate({ refreshReuseGraceSeconds: 121 }))).toEqual([
        {
          field: 'refreshReuseGraceSeconds',
          message: 'refreshReuseGraceSeconds must be a whole number from 0 to 120.',
        },
      ]);
    });

    it('accepts a refresh reuse grace of 0 and of 120', () => {
      expect(checkAuthSettings(candidate({ refreshReuseGraceSeconds: 0 }))).toEqual([]);
      expect(checkAuthSettings(candidate({ refreshReuseGraceSeconds: 120 }))).toEqual([]);
    });

    it('refuses a negative refresh reuse grace', () => {
      expect(checkAuthSettings(candidate({ refreshReuseGraceSeconds: -1 }))).toEqual([
        {
          field: 'refreshReuseGraceSeconds',
          message: 'refreshReuseGraceSeconds must be a whole number from 0 to 120.',
        },
      ]);
    });

    it('refuses an email verification grace above 720 hours', () => {
      expect(checkAuthSettings(candidate({ emailVerificationGraceHours: 721 }))).toEqual([
        {
          field: 'emailVerificationGraceHours',
          message: 'emailVerificationGraceHours must be a whole number from 0 to 720.',
        },
      ]);
    });

    it('accepts an email verification grace of 720 hours', () => {
      expect(checkAuthSettings(candidate({ emailVerificationGraceHours: 720 }))).toEqual([]);
    });

    it('refuses a non-boolean staff MFA flag', () => {
      expect(checkAuthSettings(candidate({ staffMfaRequired: 'yes' }))).toEqual([
        { field: 'staffMfaRequired', message: 'staffMfaRequired must be true or false.' },
      ]);
    });

    it('accepts staff MFA turned off', () => {
      expect(checkAuthSettings(candidate({ staffMfaRequired: false }))).toEqual([]);
    });

    it('checks the idle window against the candidate access-token life, reporting only the idle field', () => {
      expect(
        checkAuthSettings(candidate({ accessTokenMinutes: 60, staffRefreshIdleMinutes: 45 })),
      ).toEqual([
        {
          field: 'staffRefreshIdleMinutes',
          message: 'staffRefreshIdleMinutes must be greater than accessTokenMinutes (60).',
        },
      ]);
    });
  });

  describe('isFieldValid', () => {
    it('checks an idle window against the resolved access-token life it is given', () => {
      expect(isFieldValid('staffRefreshIdleMinutes', 45, { accessTokenMinutes: 30 })).toBe(true);
      expect(isFieldValid('staffRefreshIdleMinutes', 45, { accessTokenMinutes: 60 })).toBe(false);
    });

    it('refuses a dependent field whose dependency has not been resolved', () => {
      expect(isFieldValid('customerRefreshAbsoluteMinutes', 50000, {})).toBe(false);
    });

    it('refuses a value of the wrong type', () => {
      expect(isFieldValid('accessTokenMinutes', '30', {})).toBe(false);
      expect(isFieldValid('staffMfaRequired', 1, {})).toBe(false);
    });
  });
});
