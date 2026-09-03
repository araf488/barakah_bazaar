import { validateEnv } from './validate-env';

const productionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@db.example.supabase.co:5432/postgres',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  CORS_ALLOWED_ORIGINS: 'https://barakahbazaar.com.bd',
};

/** productionEnv minus one key, to prove that key is genuinely required. */
const productionEnvWithout = (key: keyof typeof productionEnv): Record<string, unknown> => {
  const env: Record<string, unknown> = { ...productionEnv };
  delete env[key];
  return env;
};

const stagingEnv = {
  NODE_ENV: 'staging',
  DATABASE_URL: 'postgresql://user:pass@db.example.supabase.co:5432/postgres',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  CORS_ALLOWED_ORIGINS: 'https://stage.barakahbazaar.com.bd',
};

/** stagingEnv minus one key, to prove that key is genuinely required. */
const stagingEnvWithout = (key: keyof typeof stagingEnv): Record<string, unknown> => {
  const env: Record<string, unknown> = { ...stagingEnv };
  delete env[key];
  return env;
};

describe('validateEnv', () => {
  describe('defaults', () => {
    it('boots with an empty environment, so a fresh clone runs', () => {
      const env = validateEnv({});

      expect(env.NODE_ENV).toBe('development');
      expect(env.PORT).toBe(3000);
      expect(env.API_PREFIX).toBe('api');
      expect(env.API_VERSION).toBe('v1');
    });

    it('defaults Swagger and the queue to off', () => {
      const env = validateEnv({});

      expect(env.SWAGGER_ENABLED).toBe(false);
      expect(env.QUEUE_ENABLED).toBe(false);
    });

    it('defaults the SMS provider to noop so tests spend no credits', () => {
      expect(validateEnv({}).SMS_PROVIDER).toBe('noop');
    });

    it('defaults the identity vars, so a fresh clone still boots', () => {
      const env = validateEnv({});

      expect(env.JWT_SECRET).toBeUndefined();
      expect(env.JWT_ISSUER).toBe('barakah-bazaar-api');
      expect(env.JWT_AUDIENCE).toBe('barakah-bazaar');
      expect(env.TOTP_ENCRYPTION_KEY).toBeUndefined();
      expect(env.SCRYPT_COST_LOG2).toBe(15);
      expect(env.SCRYPT_BLOCK_SIZE).toBe(8);
      expect(env.SCRYPT_PARALLELISM).toBe(3);
      expect(env.AUTH_RATE_LIMIT).toBe(10);
      expect(env.AUTH_SETTINGS_CACHE_SECONDS).toBe(60);
      expect(env.SESSION_TOUCH_INTERVAL_MINUTES).toBe(5);
      expect(env.APP_PUBLIC_BASE_URL).toBe('http://localhost:3000');
    });
  });

  describe('coercion', () => {
    it('coerces a numeric port from its string form', () => {
      expect(validateEnv({ PORT: '8080' }).PORT).toBe(8080);
    });

    it('parses boolean flags from strings', () => {
      expect(validateEnv({ SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED).toBe(true);
    });

    it('treats an empty string as unset rather than an invalid value', () => {
      expect(validateEnv({ SUPABASE_URL: '' }).SUPABASE_URL).toBeUndefined();
    });
  });

  describe('rejections', () => {
    it('rejects a non-numeric port', () => {
      expect(() => validateEnv({ PORT: 'not-a-port' })).toThrow(/PORT/);
    });

    it('rejects an out-of-range port', () => {
      expect(() => validateEnv({ PORT: '70000' })).toThrow(/PORT/);
    });

    it('rejects an unknown NODE_ENV', () => {
      expect(() => validateEnv({ NODE_ENV: 'staging-2' })).toThrow(/NODE_ENV/);
    });

    it('rejects a malformed Supabase URL', () => {
      expect(() => validateEnv({ SUPABASE_URL: 'not-a-url' })).toThrow(/SUPABASE_URL/);
    });

    it('rejects a SCRYPT_COST_LOG2 outside 12-20', () => {
      expect(() => validateEnv({ SCRYPT_COST_LOG2: '11' })).toThrow(/SCRYPT_COST_LOG2/);
      expect(() => validateEnv({ SCRYPT_COST_LOG2: '21' })).toThrow(/SCRYPT_COST_LOG2/);
    });

    it('reports every problem in one message', () => {
      // Order follows the schema, not the input, so assert on content only.
      let message = '';
      try {
        validateEnv({ PORT: 'nope', NODE_ENV: 'nope' });
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toContain('PORT');
      expect(message).toContain('NODE_ENV');
    });
  });

  describe('production hardening', () => {
    it('accepts a fully configured production environment', () => {
      expect(() => validateEnv(productionEnv)).not.toThrow();
    });

    it('requires DATABASE_URL', () => {
      expect(() => validateEnv(productionEnvWithout('DATABASE_URL'))).toThrow(
        /DATABASE_URL is required/,
      );
    });

    it('requires the service-role key', () => {
      expect(() => validateEnv(productionEnvWithout('SUPABASE_SERVICE_ROLE_KEY'))).toThrow(
        /SUPABASE_SERVICE_ROLE_KEY is required/,
      );
    });

    it('refuses to expose Swagger', () => {
      expect(() => validateEnv({ ...productionEnv, SWAGGER_ENABLED: 'true' })).toThrow(
        /SWAGGER_ENABLED must be false in production/,
      );
    });

    it('refuses an empty CORS allowlist', () => {
      expect(() => validateEnv({ ...productionEnv, CORS_ALLOWED_ORIGINS: '  ' })).toThrow(
        /CORS_ALLOWED_ORIGINS must list/,
      );
    });

    it('requires a way to verify JWTs', () => {
      expect(() => validateEnv(productionEnvWithout('SUPABASE_URL'))).toThrow(
        /JWT verification is unconfigured/,
      );
    });

    it('stays permissive in development', () => {
      expect(() => validateEnv({ NODE_ENV: 'development', SWAGGER_ENABLED: 'true' })).not.toThrow();
    });

    it('stays permissive in test, since the whole e2e suite boots with NODE_ENV=test', () => {
      expect(() => validateEnv({ NODE_ENV: 'test', SWAGGER_ENABLED: 'true' })).not.toThrow();
    });
  });

  describe('staging hardening', () => {
    it('accepts a fully configured staging environment', () => {
      expect(() => validateEnv(stagingEnv)).not.toThrow();
    });

    it('requires DATABASE_URL', () => {
      expect(() => validateEnv(stagingEnvWithout('DATABASE_URL'))).toThrow(
        /DATABASE_URL is required when NODE_ENV=staging/,
      );
    });

    it('requires SUPABASE_URL', () => {
      expect(() => validateEnv(stagingEnvWithout('SUPABASE_URL'))).toThrow(
        /SUPABASE_URL is required when NODE_ENV=staging/,
      );
    });

    it('requires the service-role key', () => {
      expect(() => validateEnv(stagingEnvWithout('SUPABASE_SERVICE_ROLE_KEY'))).toThrow(
        /SUPABASE_SERVICE_ROLE_KEY is required when NODE_ENV=staging/,
      );
    });

    it('refuses an empty CORS allowlist', () => {
      expect(() => validateEnv({ ...stagingEnv, CORS_ALLOWED_ORIGINS: '  ' })).toThrow(
        /CORS_ALLOWED_ORIGINS must list/,
      );
    });

    it('permits Swagger, because QA and the client need the docs page', () => {
      expect(() => validateEnv({ ...stagingEnv, SWAGGER_ENABLED: 'true' })).not.toThrow();
    });

    it('names staging, not production, in the missing-key message', () => {
      let message = '';
      try {
        validateEnv(stagingEnvWithout('DATABASE_URL'));
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toContain('NODE_ENV=staging');
      expect(message).not.toContain('NODE_ENV=production');
    });

    it('reports the unconfigured-JWT consequence alongside the missing key', () => {
      // Removing SUPABASE_URL trips both the required-key rule and the JWT rule.
      // The JWT issue never fires alone, but it names the actual consequence.
      let message = '';
      try {
        validateEnv(stagingEnvWithout('SUPABASE_URL'));
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toContain('SUPABASE_URL is required when NODE_ENV=staging');
      expect(message).toContain('JWT verification is unconfigured');
    });
  });
});
