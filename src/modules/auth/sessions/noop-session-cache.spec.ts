import { UserRole } from '../../../infra/prisma/prisma-client';
import { CachedSessionValue } from './session-cache.port';
import { NoopSessionCache } from './noop-session-cache';

const value: CachedSessionValue = {
  userId: 'user-1',
  role: UserRole.CUSTOMER,
  email: 'shopper@example.com',
  phone: null,
  isActive: true,
  deviceId: 'device-1',
  expiresAt: new Date('2026-09-02T13:00:00.000Z').toISOString(),
  absoluteExpiresAt: new Date('2026-10-02T13:00:00.000Z').toISOString(),
  revokedAt: null,
};

describe('NoopSessionCache', () => {
  let cache: NoopSessionCache;

  beforeEach(() => {
    cache = new NoopSessionCache();
  });

  it('is always a miss, even right after a write for the same session', async () => {
    await cache.write('session-1', value, 300);

    await expect(cache.read('session-1', 'user-1')).resolves.toBeNull();
  });

  it('write resolves without storing anything observable', async () => {
    await expect(cache.write('session-1', value, 300)).resolves.toBeUndefined();
  });

  it('invalidateSession and invalidateUser are no-ops that resolve', async () => {
    await expect(cache.invalidateSession('session-1')).resolves.toBeUndefined();
    await expect(cache.invalidateUser('user-1')).resolves.toBeUndefined();
  });
});
