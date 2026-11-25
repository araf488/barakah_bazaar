import { Controller, Get } from '@nestjs/common';
import { createExecutionContext } from '../../../test/support/mocks';
import { RateLimit, optsIntoRateLimit } from './rate-limit.decorator';

const AUTH = 'auth';
const GEOCODING = 'geocoding';

class HandlerScoped {
  @RateLimit(AUTH)
  throttled(): void {}

  @RateLimit(AUTH, GEOCODING)
  throttledTwice(): void {}

  plain(): void {}
}

@Controller()
@RateLimit(GEOCODING)
class ClassScoped {
  @Get()
  inherits(): void {}
}

/** The handler and class the throttler's `skipIf` would be handed for one route. */
const contextFor = (handler: object, controller: object = class Bare {}) =>
  createExecutionContext({ handlerMetadata: handler, classMetadata: controller }).context;

describe('RateLimit', () => {
  describe('a bucket named on the handler', () => {
    it('opts that handler into the bucket', () => {
      const context = contextFor(HandlerScoped.prototype.throttled);

      expect(optsIntoRateLimit(context, AUTH)).toBe(true);
    });

    it('opts into every bucket it names', () => {
      const context = contextFor(HandlerScoped.prototype.throttledTwice);

      expect(optsIntoRateLimit(context, AUTH)).toBe(true);
      expect(optsIntoRateLimit(context, GEOCODING)).toBe(true);
    });

    it('does not opt into a bucket it did not name', () => {
      const context = contextFor(HandlerScoped.prototype.throttled);

      expect(optsIntoRateLimit(context, GEOCODING)).toBe(false);
    });
  });

  describe('a bucket named on the controller', () => {
    it('opts every handler on it into the bucket', () => {
      const context = contextFor(ClassScoped.prototype.inherits, ClassScoped);

      expect(optsIntoRateLimit(context, GEOCODING)).toBe(true);
    });
  });

  describe('a route with no @RateLimit at all', () => {
    // This is the case the whole decorator exists for: left to itself the library counts
    // every registered bucket against every route, so an undecorated storefront endpoint
    // inherited the login bucket's limit.
    it('opts into nothing', () => {
      const context = contextFor(HandlerScoped.prototype.plain);

      expect(optsIntoRateLimit(context, AUTH)).toBe(false);
      expect(optsIntoRateLimit(context, GEOCODING)).toBe(false);
    });
  });
});
