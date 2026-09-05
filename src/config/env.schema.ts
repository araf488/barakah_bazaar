import { z } from 'zod';
import { EnvConstants, EnvValidationMessages, requiredKeyMessage } from './env.constants';

/**
 * Environment contract for the API. Parsed once at boot; a failure here stops
 * the process rather than letting a half-configured app serve traffic.
 *
 * Optional values are genuinely optional: the app boots without Supabase or
 * Redis configured and reports the affected subsystem as degraded on /health,
 * so a fresh clone runs before anyone has a Supabase project.
 */

/** `.env` files carry empty strings for "unset"; treat those as absent. */
const emptyToUndefined = (raw: unknown): unknown => {
  if (raw === null || typeof raw !== 'object') {
    return raw;
  }
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).map(([key, value]) => [
      key,
      value === '' ? undefined : value,
    ]),
  );
};

const boolFlag = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((value) => value === 'true');

const baseEnvSchema = z.object({
  // ── Application ───────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  API_PREFIX: z.string().min(1).default('api'),
  API_VERSION: z.string().min(1).default('v1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Comma-separated. Empty means no cross-origin browser call is allowed. */
  CORS_ALLOWED_ORIGINS: z.string().default(''),
  SWAGGER_ENABLED: boolFlag('false'),

  // ── Database ──────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1).optional(),
  DIRECT_URL: z.string().min(1).optional(),

  // ── Supabase (Storage only) ───────────────────────────────────────────────
  // No auth keys: this API issues its own tokens and reads roles from its own tables. What
  // remains is the storage client, which needs a project and the service-role key to sign
  // uploads.
  SUPABASE_URL: z.url().optional(),
  /** Server-side only. Bypasses RLS — never expose to any client bundle. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // ── Redis / BullMQ ────────────────────────────────────────────────────────
  QUEUE_ENABLED: boolFlag('false'),
  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().max(65535).default(6379),
  REDIS_PASSWORD: z.string().min(1).optional(),
  REDIS_TLS: boolFlag('false'),
  /**
   * Caches `SessionRepository.findByIdWithUser`, the one database read `SessionService.validate`
   * runs on every authenticated request. Off by default, same shape as QUEUE_ENABLED: local
   * development and CI need no Redis. Revocation is never left to the TTL alone — see
   * `SessionCachePort`.
   */
  SESSION_CACHE_ENABLED: boolFlag('false'),

  // ── Email sender ──────────────────────────────────────────────────────────
  // Defaults to noop, which logs the recipient and reports success. While it is noop the
  // staff-invitation endpoint returns the raw token in its response so the flow can be
  // completed in development; with a real provider it never leaves the email.
  EMAIL_PROVIDER: z.enum(['noop', 'resend', 'smtp']).default('noop'),
  EMAIL_FROM: z.string().min(1).optional(),
  EMAIL_SMTP_HOST: z.string().min(1).optional(),
  EMAIL_SMTP_PORT: z.coerce.number().int().positive().max(65535).default(587),
  EMAIL_SMTP_USER: z.string().min(1).optional(),
  EMAIL_SMTP_PASSWORD: z.string().min(1).optional(),
  /** Implicit TLS on connect (port 465). Leave false for STARTTLS on 587. */
  EMAIL_SMTP_SECURE: boolFlag('false'),

  // ── Payment gateway ───────────────────────────────────────────────────────
  // Defaults to noop, which REFUSES every charge. Cash on delivery is unaffected: it never
  // goes through a gateway. See gateways/noop-payment.gateway.ts for why money fails closed
  // where SMS fails open.
  PAYMENT_PROVIDER: z.enum(['noop', 'bkash']).default('noop'),
  PAYMENT_API_URL: z.url().optional(),
  PAYMENT_APP_KEY: z.string().min(1).optional(),
  PAYMENT_APP_SECRET: z.string().min(1).optional(),

  // ── SMS gateway ───────────────────────────────────────────────────────────
  SMS_PROVIDER: z.enum(['noop', 'alpha-sms', 'ssl-wireless']).default('noop'),
  SMS_API_URL: z.url().optional(),
  SMS_API_KEY: z.string().min(1).optional(),
  SMS_SENDER_ID: z.string().min(1).optional(),

  // ── Geocoding (map search on the address form) ────────────────────────────
  // Defaults to Photon: free, keyless, and the only provider tested against real
  // Dhaka addresses. `noop` disables map search entirely, which is what the test
  // suite uses so it never calls a third party.
  GEOCODING_PROVIDER: z.enum(['noop', 'photon', 'geoapify']).default('photon'),
  PHOTON_API_URL: z.url().default('https://photon.komoot.io'),
  GEOAPIFY_API_URL: z.url().default('https://api.geoapify.com'),
  GEOAPIFY_API_KEY: z.string().min(1).optional(),
  /** Requests per minute, per IP, allowed against the outbound geocoding proxies. */
  GEOCODING_RATE_LIMIT: z.coerce.number().int().positive().default(30),

  // ── Identity ──────────────────────────────────────────────────────────────
  /** HS256 signing secret. Absent, a random one is generated per boot with a warning. */
  JWT_SECRET: z.string().min(32).optional(),
  JWT_ISSUER: z.string().min(1).default('barakah-bazaar-api'),
  JWT_AUDIENCE: z.string().min(1).default('barakah-bazaar'),
  /** base64, 32 bytes. Encrypts TOTP secrets at rest. */
  TOTP_ENCRYPTION_KEY: z.string().min(1).optional(),
  SCRYPT_COST_LOG2: z.coerce.number().int().min(12).max(20).default(15),
  SCRYPT_BLOCK_SIZE: z.coerce.number().int().min(1).max(32).default(8),
  SCRYPT_PARALLELISM: z.coerce.number().int().min(1).max(16).default(3),
  /** Requests per minute, per caller IP, allowed against login, MFA verification and refresh. */
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  /**
   * Requests per minute, per submitted account (email), allowed against the same routes —
   * bounds a distributed attempt against one account spread across many IPs, which
   * AUTH_RATE_LIMIT alone cannot see since it counts each IP separately.
   */
  AUTH_ACCOUNT_RATE_LIMIT: z.coerce.number().int().positive().default(20),
  AUTH_SETTINGS_CACHE_SECONDS: z.coerce.number().int().min(0).default(60),
  SESSION_TOUCH_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(5),
  /** Base for verification and reset links. NEVER derived from the request Host header. */
  APP_PUBLIC_BASE_URL: z.url().default('http://localhost:3000'),

  // ── API rate limiting ─────────────────────────────────────────────────────
  /**
   * Requests per minute, per caller, per endpoint, allowed against any state-changing
   * method — POST, PATCH, PUT, DELETE. Reads are deliberately unlimited here: a storefront
   * browses far faster than it writes, and the abuse worth stopping at the app layer (order
   * spam, review flooding, repeated credential changes) is all writes. An endpoint needing a
   * tighter bound names its own bucket instead; the `auth-ip`/`auth-account` pair already does.
   */
  WRITE_RATE_LIMIT: z.coerce.number().int().positive().default(60),
});

export type Env = z.infer<typeof baseEnvSchema>;

/**
 * Environments that serve real traffic. Staging is included because QA and the
 * client hit it, so it gets production-grade configuration checks.
 */
const DEPLOYED_ENVS = ['staging', 'production'] as const satisfies readonly Env['NODE_ENV'][];

/** Values that must be present before the app may serve traffic in any deployed environment. */
const DEPLOYED_ENV_REQUIRED_KEYS = [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  // Absent, the app boots with a per-process random signing key: every restart, and every
  // instance behind a load balancer, invalidates tokens the others issued.
  'JWT_SECRET',
  // Absent, TOTP secrets cannot be decrypted, so no staff member with MFA enrolled can sign in.
  'TOTP_ENCRYPTION_KEY',
] as const satisfies readonly (keyof Env)[];

const isDeployedEnv = (nodeEnv: Env['NODE_ENV']): boolean =>
  (DEPLOYED_ENVS as readonly string[]).includes(nodeEnv);

const addIssue = (ctx: z.RefinementCtx, path: keyof Env, message: string): void => {
  ctx.addIssue({ code: 'custom', path: [path], message });
};

/**
 * Rules every deployed environment must satisfy, kept out of the base schema so
 * development and test stay cheap to run.
 */
const enforceDeployedEnvRules = (env: Env, ctx: z.RefinementCtx): void => {
  if (!isDeployedEnv(env.NODE_ENV)) {
    return;
  }

  const missing = DEPLOYED_ENV_REQUIRED_KEYS.filter((key) => env[key] === undefined);
  missing.forEach((key) => addIssue(ctx, key, requiredKeyMessage(key, env.NODE_ENV)));

  // Links in verification and reset emails are built from this. Over plain http a token in
  // the query string travels in clear text, and it is a credential.
  if (!env.APP_PUBLIC_BASE_URL.startsWith(EnvConstants.HttpsScheme)) {
    addIssue(ctx, 'APP_PUBLIC_BASE_URL', EnvValidationMessages.PublicBaseUrlNotHttps);
  }

  if (env.CORS_ALLOWED_ORIGINS.trim().length === 0) {
    addIssue(ctx, 'CORS_ALLOWED_ORIGINS', EnvValidationMessages.CorsAllowlistEmpty);
  }
};

/**
 * Production-only hardening. Staging deliberately keeps Swagger available so QA
 * and the client can read the API contract.
 */
const enforceProductionOnlyRules = (env: Env, ctx: z.RefinementCtx): void => {
  if (env.NODE_ENV !== 'production') {
    return;
  }

  if (env.SWAGGER_ENABLED) {
    addIssue(ctx, 'SWAGGER_ENABLED', EnvValidationMessages.SwaggerEnabledInProduction);
  }
};

export const envSchema = z.preprocess(emptyToUndefined, baseEnvSchema).superRefine((env, ctx) => {
  enforceDeployedEnvRules(env, ctx);
  enforceProductionOnlyRules(env, ctx);
});
