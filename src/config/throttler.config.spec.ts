import { ExecutionContext } from '@nestjs/common';
import { createExecutionContext } from '../../test/support/mocks';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { ThrottleBuckets, buildThrottlerOptions } from './throttler.config';

const LIMITS = { GEOCODING_RATE_LIMIT: 30, AUTH_RATE_LIMIT: 10, WRITE_RATE_LIMIT: 60 };

const WRITE_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'];
const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];

class Routes {
  @RateLimit('auth')
  login(): void {}

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

const contextFor = (handler: object, method = 'GET'): ExecutionContext =>
  createExecutionContext({ handlerMetadata: handler, classMetadata: Routes, method }).context;

/** True when the bucket would count this route's request. */
const applies = (name: string, handler: object, method = 'GET'): boolean =>
  bucket(name)?.skipIf?.(contextFor(handler, method)) === false;

describe('buildThrottlerOptions', () => {
  describe('the registered buckets', () => {
    it('configures a bucket named "auth", which is the name every @RateLimit(ThrottleBuckets.Auth) references', () => {
      expect(bucket('auth')).toEqual(
        expect.objectContaining({ name: 'auth', ttl: 60_000, limit: 10 }),
      );
    });

    it('reads the limit from AUTH_RATE_LIMIT rather than a fixed number', () => {
      const buckets = bucketsOf({ ...LIMITS, AUTH_RATE_LIMIT: 7 });

      expect(buckets).toContainEqual(expect.objectContaining({ name: 'auth', limit: 7 }));
    });

    it('keeps the existing geocoding bucket alongside it', () => {
      expect(bucket('geocoding')).toEqual(
        expect.objectContaining({ name: 'geocoding', ttl: 60_000, limit: 30 }),
      );
    });

    it('configures the write baseline from WRITE_RATE_LIMIT', () => {
      const buckets = bucketsOf({ ...LIMITS, WRITE_RATE_LIMIT: 45 });

      expect(buckets).toContainEqual(expect.objectContaining({ name: 'writes', limit: 45 }));
    });

    it('gives every bucket the same one-minute window', () => {
      expect(bucketsOf().map((option) => option.ttl)).toEqual([60_000, 60_000, 60_000]);
    });

    it('names each bucket exactly as ThrottleBuckets does, so a decorator cannot reference a bucket that was never registered', () => {
      expect(bucketsOf().map((option) => option.name)).toEqual([
        ThrottleBuckets.Geocoding,
        ThrottleBuckets.Auth,
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

  describe('the auth and geocoding buckets are opt-in', () => {
    // The guard applies each registered bucket to each request unless skipIf says otherwise,
    // so without these the strictest limit configured anywhere becomes the API-wide limit.
    it('applies the auth bucket to a route that asked for it', () => {
      expect(applies('auth', Routes.prototype.login)).toBe(true);
    });

    it('applies the geocoding bucket to a route that asked for it', () => {
      expect(applies('geocoding', Routes.prototype.search)).toBe(true);
    });

    it('leaves a route that asked for neither bucket out of both', () => {
      expect(applies('auth', Routes.prototype.browse)).toBe(false);
      expect(applies('geocoding', Routes.prototype.browse)).toBe(false);
    });

    it('does not let the auth bucket count a request to the geocoding proxies', () => {
      expect(applies('auth', Routes.prototype.search)).toBe(false);
    });

    it('does not let the geocoding bucket count a login attempt', () => {
      expect(applies('geocoding', Routes.prototype.login)).toBe(false);
    });

    it('gives every bucket a skipIf, so none can be left applying globally by omission', () => {
      const withoutSkip = bucketsOf().filter((option) => !option.skipIf);

      expect(withoutSkip).toEqual([]);
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
      expect(applies('auth', Routes.prototype.login, 'POST')).toBe(true);
      expect(bucket('auth')?.limit).toBeLessThan(bucket('writes')?.limit as number);
    });
  });
});
