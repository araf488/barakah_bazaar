import { ThrottlerStorage } from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';
import { AuthThrottlerGuard } from './auth-throttler.guard';

/** Exposes the protected method under test without weakening the production class's API. */
class TestableAuthThrottlerGuard extends AuthThrottlerGuard {
  track(req: Record<string, unknown>): Promise<string> {
    return this.getTracker(req);
  }
}

describe('AuthThrottlerGuard', () => {
  let guard: TestableAuthThrottlerGuard;

  beforeEach(() => {
    // The guard's own constructor only stores these; onModuleInit (never called here) is what
    // reads them, so empty/stub values are sufficient for exercising getTracker in isolation.
    guard = new TestableAuthThrottlerGuard([], {} as ThrottlerStorage, {} as Reflector);
  });

  it('tracks two different emails from the same IP separately', async () => {
    const first = await guard.track({ ip: '203.0.113.7', body: { email: 'a@example.com' } });
    const second = await guard.track({ ip: '203.0.113.7', body: { email: 'b@example.com' } });

    expect(first).not.toEqual(second);
  });

  it('tracks the same email from different IPs as distinct combinations, not one shared bucket', async () => {
    const first = await guard.track({ ip: '203.0.113.7', body: { email: 'a@example.com' } });
    const second = await guard.track({ ip: '198.51.100.4', body: { email: 'a@example.com' } });

    expect(first).not.toEqual(second);
  });

  it('treats an email as the same attacker regardless of case', async () => {
    const lower = await guard.track({ ip: '203.0.113.7', body: { email: 'a@example.com' } });
    const upper = await guard.track({ ip: '203.0.113.7', body: { email: 'A@EXAMPLE.COM' } });

    expect(lower).toEqual(upper);
  });

  it('falls back to the IP alone when the body has no email', async () => {
    await expect(guard.track({ ip: '203.0.113.7', body: {} })).resolves.toBe('203.0.113.7|');
  });

  it('does not throw when the body is missing entirely', async () => {
    await expect(guard.track({ ip: '203.0.113.7' })).resolves.toBe('203.0.113.7|');
  });
});
