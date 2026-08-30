import { z } from 'zod';
import { EnvValidationMessages, requiredKeyMessage } from './env.constants';

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

  // ── Supabase ──────────────────────────────────────────────────────────────
  SUPABASE_URL: z.url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  /** Server-side only. Bypasses RLS — never expose to any client bundle. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_JWKS_URL: z.url().optional(),
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),
  SUPABASE_JWT_AUDIENCE: z.string().min(1).default('authenticated'),

  // ── Redis / BullMQ ────────────────────────────────────────────────────────
  QUEUE_ENABLED: boolFlag('false'),
  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().max(65535).default(6379),
  REDIS_PASSWORD: z.string().min(1).optional(),
  REDIS_TLS: boolFlag('false'),

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

  // This never fires on its own: SUPABASE_URL is a required key above, so its
  // absence already raises an issue. It is kept because it names the actual
  // consequence next to the bare missing-key error, and because it guards the
  // invariant independently of DEPLOYED_ENV_REQUIRED_KEYS — making SUPABASE_URL
  // optional later must not silently drop JWT verification. Not dead code.
  if (!env.SUPABASE_JWT_SECRET && !env.SUPABASE_JWKS_URL && !env.SUPABASE_URL) {
    addIssue(ctx, 'SUPABASE_JWKS_URL', EnvValidationMessages.JwtVerificationUnconfigured);
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
