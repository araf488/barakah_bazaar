import { ExecutionContext } from '@nestjs/common';
import { ThrottlerException, ThrottlerLimitDetail, ThrottlerStorage } from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';
import { AuthThrottlerGuard } from './auth-throttler.guard';

/** Exposes the protected methods under test without weakening the production class's API. */
class TestableAuthThrottlerGuard extends AuthThrottlerGuard {
  track(req: Record<string, unknown>): Promise<string> {
    return this.getTracker(req);
  }

  reject(context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<void> {
    return this.throwThrottlingException(context, detail);
  }
}

/** A response whose header writes can be asserted, plus the context that carries it. */
const rejectionContext = (): {
  context: ExecutionContext;
  header: jest.Mock;
} => {
  const header = jest.fn();
  const context = {
    switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => ({ header }) }),
  } as unknown as ExecutionContext;

  return { context, header };
};

const limitDetail = (overrides: Partial<ThrottlerLimitDetail> = {}): ThrottlerLimitDetail => ({
  limit: 10,
  ttl: 60_000,
  key: 'key',
  tracker: '203.0.113.7|',
  totalHits: 11,
  timeToExpire: 42,
  isBlocked: true,
  timeToBlockExpire: 17,
  ...overrides,
});

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

  describe('rejecting a request over the limit', () => {
    // The library suffixes the header with the bucket name for every bucket but 'default',
    // so a 429 from 'writes' would otherwise carry only Retry-After-writes and a client
    // obeying the standard header would retry straight away.
    it('sets the unsuffixed Retry-After a client actually reads', async () => {
      const { context, header } = rejectionContext();

      await expect(guard.reject(context, limitDetail())).rejects.toThrow(ThrottlerException);
      expect(header).toHaveBeenCalledWith('Retry-After', 17);
    });

    it('prefers the block expiry, which is how long the caller is actually shut out', async () => {
      const { context, header } = rejectionContext();

      await expect(
        guard.reject(context, limitDetail({ timeToBlockExpire: 90, timeToExpire: 5 })),
      ).rejects.toThrow(ThrottlerException);
      expect(header).toHaveBeenCalledWith('Retry-After', 90);
    });

    it('falls back to the window expiry when no block expiry is reported', async () => {
      const { context, header } = rejectionContext();

      await expect(
        guard.reject(context, limitDetail({ timeToBlockExpire: undefined, timeToExpire: 33 })),
      ).rejects.toThrow(ThrottlerException);
      expect(header).toHaveBeenCalledWith('Retry-After', 33);
    });
  });
});
