/**
 * Message contract for environment-validation failures. These strings are the
 * first thing an operator sees when a deploy refuses to boot, so they are named
 * constants rather than inline literals.
 */
/** Fixed values the environment rules compare against. */
export const EnvConstants = {
  /** The only scheme a deployed public base URL may use: links in emails carry credentials. */
  HttpsScheme: 'https://',
} as const;

export const EnvValidationMessages = {
  /** Raised when a deployed environment has no CORS allowlist configured. */
  CorsAllowlistEmpty: 'CORS_ALLOWED_ORIGINS must list the storefront and admin origins',
  /** Raised when a deployed environment would build email links over plain http. */
  PublicBaseUrlNotHttps: 'APP_PUBLIC_BASE_URL must begin with https:// in a deployed environment',
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
