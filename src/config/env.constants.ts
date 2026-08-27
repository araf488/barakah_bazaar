/**
 * Message contract for environment-validation failures. These strings are the
 * first thing an operator sees when a deploy refuses to boot, so they are named
 * constants rather than inline literals.
 */
export const EnvValidationMessages = {
  /** Raised when a deployed environment has no CORS allowlist configured. */
  CorsAllowlistEmpty: 'CORS_ALLOWED_ORIGINS must list the storefront and admin origins',
  /** Raised when no JWKS URL, project URL or legacy HS256 secret is configured. */
  JwtVerificationUnconfigured:
    'JWT verification is unconfigured: set SUPABASE_JWKS_URL, SUPABASE_URL or SUPABASE_JWT_SECRET',
  /** Raised when Swagger is left enabled in production. Staging may enable it. */
  SwaggerEnabledInProduction: 'SWAGGER_ENABLED must be false in production',
} as const;

/**
 * Raised when a key required by a deployed environment is absent. Parameterised
 * by environment name because `staging` and `production` share the requirement
 * and the message must name whichever one is failing.
 */
export const requiredKeyMessage = (key: string, envName: string): string =>
  `${key} is required when NODE_ENV=${envName}`;
