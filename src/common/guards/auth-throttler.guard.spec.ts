import { ExecutionContext } from '@nestjs/common';
import { ThrottlerException, ThrottlerLimitDetail, ThrottlerStorage } from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';
import { AuthThrottlerGuard } from './auth-throttler.guard';

/** Exposes the protected method under test without weakening the production class's API. */
class TestableAuthThrottlerGuard extends AuthThrottlerGuard {
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
  tracker: '203.0.113.7',
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
    // reads them, so empty/stub values are sufficient for exercising throwThrottlingException
    // in isolation.
    guard = new TestableAuthThrottlerGuard([], {} as ThrottlerStorage, {} as Reflector);
  });

  // Tracking is no longer this class's job: each named bucket in throttler.config.ts carries
  // its own getTracker (auth-ip by IP, auth-account by email), tested there. This class now
  // exists solely for the Retry-After fix below.
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
