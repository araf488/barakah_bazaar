/**
 * Message contract for environment-validation failures. These strings are the
 * first thing an operator sees when a deploy refuses to boot, so they are named
 * constants rather than inline literals.
 */
/** Fixed values the environment rules compare against. */
export const EnvConstants = {
  /** The only scheme a deployed public base URL may use: links in emails carry credentials. */
  HttpsScheme: 'https://',
  /** Origin the storefront's server-side fetches reach this API on, inside the same host. */
  LoopbackHttpOrigin: 'http://127.0.0.1',
} as const;

export const EnvValidationMessages = {
  /** Raised when a deployed environment has no CORS allowlist configured. */
  CorsAllowlistEmpty: 'CORS_ALLOWED_ORIGINS must list the storefront and admin origins',
  /** Raised when a deployed environment would build email links over plain http. */
  PublicBaseUrlNotHttps: 'APP_PUBLIC_BASE_URL must begin with https:// in a deployed environment',
  /** Raised when a deployed environment selects a real email provider with no credentials. */
  EmailProviderNotConfigured:
    'EMAIL_FROM and the EMAIL_SMTP_* credentials are required when EMAIL_PROVIDER is not noop',
  /** Raised when a deployed environment selects a real SMS provider with no credentials. */
  SmsProviderNotConfigured: 'SMS_PROVIDER is set but SMS_API_URL and SMS_API_KEY are not.',
  /** Raised when a deployed environment with a real payment provider would build its callback URL over plain http. */
  ApiPublicBaseUrlNotHttps:
    'API_PUBLIC_BASE_URL must begin with https:// in a deployed environment',
  /** Raised when a deployed environment selects a real payment provider with no credentials. */
  PaymentProviderNotConfigured: 'PAYMENT_PROVIDER is set but its credentials are not.',
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
