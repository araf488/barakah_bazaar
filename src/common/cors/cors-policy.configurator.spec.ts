import { CorsPolicyConfigurator } from './cors-policy.configurator';

describe('CorsPolicyConfigurator', () => {
  describe('parseAllowedOrigins', () => {
    it('splits a comma-separated list and trims each entry', () => {
      const result = CorsPolicyConfigurator.parseAllowedOrigins(
        'https://barakahbazaar.com.bd, https://admin.barakahbazaar.com.bd',
      );

      expect(result).toEqual([
        'https://barakahbazaar.com.bd',
        'https://admin.barakahbazaar.com.bd',
      ]);
    });

    it('returns an empty list for undefined', () => {
      expect(CorsPolicyConfigurator.parseAllowedOrigins(undefined)).toEqual([]);
    });

    it('returns an empty list for an empty string', () => {
      expect(CorsPolicyConfigurator.parseAllowedOrigins('')).toEqual([]);
    });

    it('discards blank entries left by a trailing comma', () => {
      expect(CorsPolicyConfigurator.parseAllowedOrigins('https://a.com, ,')).toEqual([
        'https://a.com',
      ]);
    });
  });

  describe('isOriginAllowed', () => {
    const allowed = ['https://barakahbazaar.com.bd', 'https://*.staging.barakahbazaar.com.bd'];

    it('allows an exact match', () => {
      expect(CorsPolicyConfigurator.isOriginAllowed('https://barakahbazaar.com.bd', allowed)).toBe(
        true,
      );
    });

    it('rejects an unlisted origin', () => {
      expect(CorsPolicyConfigurator.isOriginAllowed('https://evil.example.com', allowed)).toBe(
        false,
      );
    });

    it('rejects a matching host on the wrong scheme', () => {
      // The plain-http origin is the value under test: the policy must reject it.
      // eslint-disable-next-line sonarjs/no-clear-text-protocols
      const insecureOrigin = 'http://barakahbazaar.com.bd';

      expect(CorsPolicyConfigurator.isOriginAllowed(insecureOrigin, allowed)).toBe(false);
    });

    it('rejects an origin that merely ends with an allowed one', () => {
      expect(
        CorsPolicyConfigurator.isOriginAllowed('https://notbarakahbazaar.com.bd', allowed),
      ).toBe(false);
    });

    it('allows a subdomain covered by a wildcard entry', () => {
      expect(
        CorsPolicyConfigurator.isOriginAllowed(
          'https://admin.staging.barakahbazaar.com.bd',
          allowed,
        ),
      ).toBe(true);
    });

    it('does NOT allow the apex of a wildcard entry', () => {
      expect(
        CorsPolicyConfigurator.isOriginAllowed('https://staging.barakahbazaar.com.bd', allowed),
      ).toBe(false);
    });

    it('rejects a wildcard subdomain on the wrong scheme', () => {
      // As above: the insecure scheme is what this assertion exists to reject.
      // eslint-disable-next-line sonarjs/no-clear-text-protocols
      const insecureOrigin = 'http://admin.staging.barakahbazaar.com.bd';

      expect(CorsPolicyConfigurator.isOriginAllowed(insecureOrigin, allowed)).toBe(false);
    });

    it('allows nothing when the allowlist is empty', () => {
      expect(CorsPolicyConfigurator.isOriginAllowed('https://barakahbazaar.com.bd', [])).toBe(
        false,
      );
    });
  });

  describe('build', () => {
    const invokeOriginCallback = (
      allowedOrigins: string[],
      origin: string | undefined,
    ): boolean | undefined => {
      const options = CorsPolicyConfigurator.build(allowedOrigins);
      const originOption = options.origin as (
        requestOrigin: string | undefined,
        callback: (error: Error | null, allow?: boolean) => void,
      ) => void;

      let allowed: boolean | undefined;
      originOption(origin, (_error, allow) => {
        allowed = allow;
      });
      return allowed;
    };

    it('allows a listed origin', () => {
      expect(
        invokeOriginCallback(['https://barakahbazaar.com.bd'], 'https://barakahbazaar.com.bd'),
      ).toBe(true);
    });

    it('denies an unlisted origin instead of reflecting it', () => {
      expect(
        invokeOriginCallback(['https://barakahbazaar.com.bd'], 'https://evil.example.com'),
      ).toBe(false);
    });

    it('allows a request with no Origin header, so native mobile clients work', () => {
      expect(invokeOriginCallback([], undefined)).toBe(true);
    });

    it('enables credentials', () => {
      expect(CorsPolicyConfigurator.build([]).credentials).toBe(true);
    });

    it('caps the preflight cache at 10 minutes', () => {
      expect(CorsPolicyConfigurator.build([]).maxAge).toBe(600);
    });

    it('exposes the request-id header so clients can quote it in bug reports', () => {
      expect(CorsPolicyConfigurator.build([]).exposedHeaders).toContain('x-request-id');
    });
  });
});
