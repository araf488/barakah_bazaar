import { ExecutionContext } from '@nestjs/common';
import { createExecutionContext } from '../../test/support/mocks';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { ThrottleBuckets, buildThrottlerOptions } from './throttler.config';

const LIMITS = {
  GEOCODING_RATE_LIMIT: 30,
  AUTH_RATE_LIMIT: 10,
  AUTH_ACCOUNT_RATE_LIMIT: 20,
  WRITE_RATE_LIMIT: 60,
};

const WRITE_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'];
const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];

class Routes {
  @RateLimit('auth-ip', 'auth-account')
  login(): void {}

  // Opts into both auth buckets exactly like login, but its DTO never carries an email —
  // the shape refresh and MFA verification actually send.
  @RateLimit('auth-ip', 'auth-account')
  refresh(): void {}

  @RateLimit('geocoding')
  search(): void {}

  browse(): void {}

  placeOrder(): void {}
}

/** The registered buckets, which now sit under `throttlers` rather than being the result. */
const bucketsOf = (env = LIMITS) => {
  const options = buildThrottlerOptions(env);
  return Array.isArray(options) ? options : options.throttlers;
};

const bucket = (name: string) => bucketsOf().find((option) => option.name === name);

const contextFor = (handler: object, method = 'GET', body?: unknown): ExecutionContext =>
  createExecutionContext({ handlerMetadata: handler, classMetadata: Routes, method, body }).context;

/** True when the bucket would count this route's request. */
const applies = (name: string, handler: object, method = 'GET', body?: unknown): boolean =>
  bucket(name)?.skipIf?.(contextFor(handler, method, body)) === false;

describe('buildThrottlerOptions', () => {
  describe('the registered buckets', () => {
    it('configures a bucket named "auth-ip", which is the name every @RateLimit(ThrottleBuckets.AuthIp) references', () => {
      expect(bucket('auth-ip')).toEqual(
        expect.objectContaining({ name: 'auth-ip', ttl: 60_000, limit: 10 }),
      );
    });

    it('reads the auth-ip limit from AUTH_RATE_LIMIT rather than a fixed number', () => {
      const buckets = bucketsOf({ ...LIMITS, AUTH_RATE_LIMIT: 7 });

      expect(buckets).toContainEqual(expect.objectContaining({ name: 'auth-ip', limit: 7 }));
    });

    it('configures a bucket named "auth-account", separate from auth-ip', () => {
      expect(bucket('auth-account')).toEqual(
        expect.objectContaining({ name: 'auth-account', ttl: 60_000, limit: 20 }),
      );
    });

    it('reads the auth-account limit from AUTH_ACCOUNT_RATE_LIMIT rather than a fixed number', () => {
      const buckets = bucketsOf({ ...LIMITS, AUTH_ACCOUNT_RATE_LIMIT: 13 });

      expect(buckets).toContainEqual(expect.objectContaining({ name: 'auth-account', limit: 13 }));
    });

    it('keeps the existing geocoding bucket alongside them', () => {
      expect(bucket('geocoding')).toEqual(
        expect.objectContaining({ name: 'geocoding', ttl: 60_000, limit: 30 }),
      );
    });

    it('configures the write baseline from WRITE_RATE_LIMIT', () => {
      const buckets = bucketsOf({ ...LIMITS, WRITE_RATE_LIMIT: 45 });

      expect(buckets).toContainEqual(expect.objectContaining({ name: 'writes', limit: 45 }));
    });

    it('gives every bucket the same one-minute window', () => {
      expect(bucketsOf().map((option) => option.ttl)).toEqual([60_000, 60_000, 60_000, 60_000]);
    });

    it('names each bucket exactly as ThrottleBuckets does, so a decorator cannot reference a bucket that was never registered', () => {
      expect(bucketsOf().map((option) => option.name)).toEqual([
        ThrottleBuckets.Geocoding,
        ThrottleBuckets.AuthIp,
        ThrottleBuckets.AuthAccount,
        ThrottleBuckets.Writes,
      ]);
    });
  });

  describe('the rejection message', () => {
    it('replaces the library default, which leaks its own class name to clients', () => {
      const options = buildThrottlerOptions(LIMITS);

      expect(Array.isArray(options)).toBe(false);
      expect(Array.isArray(options) ? undefined : options.errorMessage).toBe(
        'Too many requests. Please wait a moment and try again.',
      );
    });

    it('is returned in the object form, since the library ignores errorMessage on an array', () => {
      // A bare ThrottlerOptions[] silently drops the message; this is the whole reason the
      // shape changed, so it is asserted rather than left to a reviewer to notice.
      expect(buildThrottlerOptions(LIMITS)).toEqual(
        expect.objectContaining({ throttlers: expect.any(Array) }),
      );
    });
  });

  describe('the auth-ip and geocoding buckets are opt-in', () => {
    // The guard applies each registered bucket to each request unless skipIf says otherwise,
    // so without these the strictest limit configured anywhere becomes the API-wide limit.
    // This is the case whose absence let the auth bucket cap the entire API at 10/min.
    it('applies auth-ip to a route that asked for it', () => {
      expect(applies('auth-ip', Routes.prototype.login)).toBe(true);
    });

    it('applies geocoding to a route that asked for it', () => {
      expect(applies('geocoding', Routes.prototype.search)).toBe(true);
    });

    it('leaves a route that asked for neither bucket out of both, however it is called', () => {
      for (let i = 0; i < 20; i += 1) {
        expect(applies('auth-ip', Routes.prototype.browse)).toBe(false);
        expect(applies('geocoding', Routes.prototype.browse)).toBe(false);
        expect(applies('auth-account', Routes.prototype.browse)).toBe(false);
        expect(applies('writes', Routes.prototype.browse, 'GET')).toBe(false);
      }
    });

    it('does not let auth-ip count a request to the geocoding proxies', () => {
      expect(applies('auth-ip', Routes.prototype.search)).toBe(false);
    });

    it('does not let geocoding count a login attempt', () => {
      expect(applies('geocoding', Routes.prototype.login)).toBe(false);
    });

    it('gives every bucket a skipIf, so none can be left applying globally by omission', () => {
      const withoutSkip = bucketsOf().filter((option) => !option.skipIf);

      expect(withoutSkip).toEqual([]);
    });
  });

  describe('the auth-account bucket', () => {
    it('applies to a route that opted in and submitted an email', () => {
      expect(
        applies('auth-account', Routes.prototype.login, 'POST', { email: 'shopper@example.com' }),
      ).toBe(true);
    });

    it('does not apply to a route that opted in but sent no email — refresh and MFA verification', () => {
      // Without this, every such request shares one '' key and throttles the others, which is
      // not a protection this bucket exists to provide.
      expect(applies('auth-account', Routes.prototype.refresh, 'POST', {})).toBe(false);
    });

    it('does not apply to a route that never opted in, even carrying an email', () => {
      expect(
        applies('auth-account', Routes.prototype.browse, 'POST', { email: 'shopper@example.com' }),
      ).toBe(false);
    });

    it('tracks by the submitted email rather than the caller IP', () => {
      const account = bucket('auth-account');
      const fromOneIp = account?.getTracker?.(
        { ip: '203.0.113.7', body: { email: 'victim@example.com' } },
        contextFor(Routes.prototype.login),
      );
      const fromAnotherIp = account?.getTracker?.(
        { ip: '198.51.100.4', body: { email: 'victim@example.com' } },
        contextFor(Routes.prototype.login),
      );

      // The same key from two different IPs is what lets a hundred IPs attacking one account
      // be counted together — the property a single concatenated ip|email tracker cannot give.
      expect(fromOneIp).toEqual(fromAnotherIp);
    });

    it('treats an email as the same account regardless of case', () => {
      const account = bucket('auth-account');
      const lower = account?.getTracker?.(
        { ip: '203.0.113.7', body: { email: 'victim@example.com' } },
        contextFor(Routes.prototype.login),
      );
      const upper = account?.getTracker?.(
        { ip: '203.0.113.7', body: { email: 'VICTIM@EXAMPLE.COM' } },
        contextFor(Routes.prototype.login),
      );

      expect(lower).toEqual(upper);
    });

    it('tracks two different accounts from the same IP separately', () => {
      const account = bucket('auth-account');
      const first = account?.getTracker?.(
        { ip: '203.0.113.7', body: { email: 'a@example.com' } },
        contextFor(Routes.prototype.login),
      );
      const second = account?.getTracker?.(
        { ip: '203.0.113.7', body: { email: 'b@example.com' } },
        contextFor(Routes.prototype.login),
      );

      expect(first).not.toEqual(second);
    });
  });

  describe('the auth-ip bucket', () => {
    it('tracks by the caller IP rather than the submitted email', () => {
      const ipBucket = bucket('auth-ip');
      const fromOneEmail = ipBucket?.getTracker?.(
        { ip: '203.0.113.7', body: { email: 'a@example.com' } },
        contextFor(Routes.prototype.login),
      );
      const fromAnotherEmail = ipBucket?.getTracker?.(
        { ip: '203.0.113.7', body: { email: 'b@example.com' } },
        contextFor(Routes.prototype.login),
      );

      // The same key from two different emails is what lets one IP working through many
      // accounts be counted together — the property a single concatenated tracker also misses.
      expect(fromOneEmail).toEqual(fromAnotherEmail);
    });

    it('tracks two different IPs separately', () => {
      const ipBucket = bucket('auth-ip');
      const first = ipBucket?.getTracker?.(
        { ip: '203.0.113.7', body: { email: 'a@example.com' } },
        contextFor(Routes.prototype.login),
      );
      const second = ipBucket?.getTracker?.(
        { ip: '198.51.100.4', body: { email: 'a@example.com' } },
        contextFor(Routes.prototype.login),
      );

      expect(first).not.toEqual(second);
    });

    it('still tracks a request that carries no email at all', () => {
      const ipBucket = bucket('auth-ip');

      expect(
        ipBucket?.getTracker?.({ ip: '203.0.113.7' }, contextFor(Routes.prototype.refresh)),
      ).toBe('203.0.113.7');
    });
  });

  describe('the write baseline', () => {
    it.each(WRITE_METHODS)('counts a %s, with no decorator on the route', (method) => {
      expect(applies('writes', Routes.prototype.placeOrder, method)).toBe(true);
    });

    it.each(READ_METHODS)('ignores a %s', (method) => {
      expect(applies('writes', Routes.prototype.browse, method)).toBe(false);
    });

    it('reads the method case-insensitively rather than trusting its casing', () => {
      expect(applies('writes', Routes.prototype.placeOrder, 'post')).toBe(true);
    });

    it('counts a request whose method it cannot read, rather than waving it through', () => {
      // The read-only set is an allowlist, so anything unrecognised is bounded. For a rate
      // limiter that is the right polarity: an unreadable method should cost a token, not
      // buy an exemption.
      const context = createExecutionContext({
        handlerMetadata: Routes.prototype.placeOrder,
        classMetadata: Routes,
      }).context;

      expect(bucket('writes')?.skipIf?.(context)).toBe(false);
    });

    it('holds a write that also names a tighter bucket to the tighter limit', () => {
      // Login is a POST, so it lands in both buckets at once; 10 has to be the one that bites.
      expect(applies('writes', Routes.prototype.login, 'POST')).toBe(true);
      expect(applies('auth-ip', Routes.prototype.login, 'POST')).toBe(true);
      expect(bucket('auth-ip')?.limit).toBeLessThan(bucket('writes')?.limit as number);
    });
  });
});
