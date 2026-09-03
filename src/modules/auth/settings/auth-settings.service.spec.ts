import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../../test/support/mocks';
import { AuthSettingsRepository } from './auth-settings.repository';
import { AuthSettingsService, AUTH_SETTINGS_DEFAULTS } from './auth-settings.service';

const row = (overrides = {}) => ({
  id: 'singleton',
  accessTokenMinutes: 30,
  customerRefreshIdleMinutes: 43200,
  customerRefreshAbsoluteMinutes: 129600,
  staffRefreshIdleMinutes: 720,
  staffRefreshAbsoluteMinutes: 10080,
  staffMfaRequired: true,
  emailVerificationGraceHours: 168,
  refreshReuseGraceSeconds: 30,
  updatedAt: new Date(),
  ...overrides,
});

describe('AuthSettingsService', () => {
  let repository: { load: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: AuthSettingsService;

  beforeEach(() => {
    repository = { load: jest.fn().mockResolvedValue(row()) };
    logger = createMockLogger();
    service = new AuthSettingsService(repository as unknown as AuthSettingsRepository, logger, 60);
  });

  it('returns the stored values', async () => {
    repository.load.mockResolvedValue(row({ accessTokenMinutes: 45 }));

    expect((await service.current()).accessTokenMinutes).toBe(45);
  });

  it('caches, so a second call inside the window does not re-read', async () => {
    await service.current();
    await service.current();

    expect(repository.load).toHaveBeenCalledTimes(1);
  });

  it('re-reads once the cache window has passed', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-02T00:00:00Z'));
    await service.current();
    jest.setSystemTime(new Date('2026-09-02T00:02:00Z'));
    await service.current();

    expect(repository.load).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('falls back to defaults when the row is absent, and warns', async () => {
    repository.load.mockResolvedValue(undefined);

    expect(await service.current()).toEqual(AUTH_SETTINGS_DEFAULTS);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('warns only once across multiple absent reads, even after the cache expires', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-02T00:00:00Z'));
    repository.load.mockResolvedValue(undefined);

    await service.current();
    jest.setSystemTime(new Date('2026-09-02T00:02:00Z'));
    await service.current();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('falls back to defaults when the read fails, and logs distinctly from an absent row', async () => {
    repository.load.mockResolvedValue(null);

    expect((await service.current()).accessTokenMinutes).toBe(30);
    expect(logger.error).toHaveBeenCalledWith('Auth settings read failed; using defaults');
  });

  it('falls back to defaults when the read throws', async () => {
    repository.load.mockRejectedValue(new Error('boom'));

    expect((await service.current()).accessTokenMinutes).toBe(30);
    expect(logger.error).toHaveBeenCalled();
  });

  it('rejects an access-token life below the floor and logs the field name', async () => {
    repository.load.mockResolvedValue(row({ accessTokenMinutes: 1 }));

    expect((await service.current()).accessTokenMinutes).toBe(30);
    expect(logger.error.mock.calls[0][0]).toMatchObject({ field: 'accessTokenMinutes' });
  });

  it('rejects an access-token life above the ceiling', async () => {
    repository.load.mockResolvedValue(row({ accessTokenMinutes: 5000 }));

    expect((await service.current()).accessTokenMinutes).toBe(30);
  });

  it('rejects an idle window shorter than the access token, which would be unusable', async () => {
    // The access token would outlive the window in which it could be refreshed.
    repository.load.mockResolvedValue(row({ accessTokenMinutes: 30, staffRefreshIdleMinutes: 20 }));

    expect((await service.current()).staffRefreshIdleMinutes).toBe(720);
  });

  it('rejects an absolute cap below its own idle window', async () => {
    repository.load.mockResolvedValue(
      row({ customerRefreshIdleMinutes: 43200, customerRefreshAbsoluteMinutes: 100 }),
    );

    expect((await service.current()).customerRefreshAbsoluteMinutes).toBe(129600);
  });

  it('clamps a rejected staff absolute cap up to the resolved idle window, not just its own fixed default', async () => {
    // The idle window was raised and is itself valid, so it is kept. The absolute cap is
    // rejected and falls back to its *fixed* default (10080) — but that default is shorter
    // than the raised idle window, which would violate the very invariant rule 3 exists to
    // enforce. The resolved pair must satisfy the invariant, not just the input that was
    // validated.
    repository.load.mockResolvedValue(
      row({ staffRefreshIdleMinutes: 20160, staffRefreshAbsoluteMinutes: 0 }),
    );

    const settings = await service.current();

    expect(settings.staffRefreshIdleMinutes).toBe(20160);
    expect(settings.staffRefreshAbsoluteMinutes).toBe(20160);
  });

  it('clamps a rejected customer absolute cap up to the resolved idle window the same way', async () => {
    repository.load.mockResolvedValue(
      row({ customerRefreshIdleMinutes: 200000, customerRefreshAbsoluteMinutes: 0 }),
    );

    const settings = await service.current();

    expect(settings.customerRefreshIdleMinutes).toBe(200000);
    expect(settings.customerRefreshAbsoluteMinutes).toBe(200000);
  });

  it('leaves a valid absolute cap unchanged, so the clamp does not silently rewrite good values', async () => {
    // Distinct from both the field's own default and its own idle window, so a clamp that
    // collapsed every value to its floor (or to the default) would be caught here, not just
    // a clamp that failed to raise a bad one.
    repository.load.mockResolvedValue(
      row({
        customerRefreshIdleMinutes: 50000,
        customerRefreshAbsoluteMinutes: 60000,
        staffRefreshIdleMinutes: 900,
        staffRefreshAbsoluteMinutes: 1000,
      }),
    );

    const settings = await service.current();

    expect(settings.customerRefreshAbsoluteMinutes).toBe(60000);
    expect(settings.staffRefreshAbsoluteMinutes).toBe(1000);
  });

  it('keeps the valid fields when one field is rejected', async () => {
    repository.load.mockResolvedValue(row({ accessTokenMinutes: 1, staffMfaRequired: false }));

    const settings = await service.current();

    expect(settings.accessTokenMinutes).toBe(30);
    expect(settings.staffMfaRequired).toBe(false);
  });

  it('validates the idle window against the resolved access-token value, not the raw row value', async () => {
    // accessTokenMinutes = 5000 is rejected (ceiling 120) and resolves to the default, 30.
    // staffRefreshIdleMinutes = 1440 is a sane 24-hour window: greater than the *resolved*
    // 30, so it should be kept — but a comparison against the raw, unvalidated 5000 would
    // see 1440 is not greater than 5000 and wrongly reject it back to the default, 720.
    repository.load.mockResolvedValue(
      row({ accessTokenMinutes: 5000, staffRefreshIdleMinutes: 1440 }),
    );

    expect((await service.current()).staffRefreshIdleMinutes).toBe(1440);
  });

  it('freezes the defaults so accidental mutation cannot happen', () => {
    expect(Object.isFrozen(AUTH_SETTINGS_DEFAULTS)).toBe(true);
  });
});
