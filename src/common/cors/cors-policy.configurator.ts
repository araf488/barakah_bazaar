import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ApplicationConstants } from '../constants/app.constants';

/** Seconds a browser may cache a preflight result. */
const PREFLIGHT_MAX_AGE_SECONDS = 600;

const WILDCARD_SUBDOMAIN_PREFIX = '*.';

/**
 * CORS policy for the storefront, admin portal and any browser client.
 *
 * Reflecting the request origin while also allowing credentials (CWE-942)
 * would let any site a signed-in customer visits make authenticated calls on
 * their behalf, so origins come from configuration only and an empty list
 * allows nothing. Native mobile requests carry no Origin header and are
 * unaffected by any of this.
 */
export const CorsPolicyConfigurator = {
  /** Env var holding the comma-separated origin allowlist. */
  AllowedOriginsConfigKey: 'CORS_ALLOWED_ORIGINS',
  PreflightMaxAgeSeconds: PREFLIGHT_MAX_AGE_SECONDS,

  /** Splits and trims the configured list. Blank entries are discarded. */
  parseAllowedOrigins(raw: string | undefined): string[] {
    return (raw ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  },

  /**
   * Exact match, or a wildcard entry like `https://*.barakahbazaar.com.bd`
   * which matches any single-or-multi-level subdomain but NOT the apex.
   */
  isOriginAllowed(origin: string, allowedOrigins: readonly string[]): boolean {
    return allowedOrigins.some((allowed) => CorsPolicyConfigurator.matches(origin, allowed));
  },

  build(allowedOrigins: readonly string[]): CorsOptions {
    return {
      origin: (origin, callback) => {
        // No Origin header: same-origin, curl, or a native mobile client.
        if (!origin) {
          callback(null, true);
          return;
        }
        callback(null, CorsPolicyConfigurator.isOriginAllowed(origin, allowedOrigins));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Accept-Language',
        ApplicationConstants.RequestIdHeader,
      ],
      exposedHeaders: [ApplicationConstants.RequestIdHeader],
      maxAge: PREFLIGHT_MAX_AGE_SECONDS,
    };
  },

  matches(origin: string, allowed: string): boolean {
    if (origin === allowed) {
      return true;
    }

    const wildcardIndex = allowed.indexOf(WILDCARD_SUBDOMAIN_PREFIX);
    if (wildcardIndex === -1) {
      return false;
    }

    const scheme = allowed.slice(0, wildcardIndex);
    const baseDomain = allowed.slice(wildcardIndex + WILDCARD_SUBDOMAIN_PREFIX.length);

    return (
      origin.startsWith(scheme) &&
      origin.endsWith(`.${baseDomain}`) &&
      origin.length > scheme.length + baseDomain.length + 1
    );
  },
} as const;
