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

    it('applies none of these rules outside production', () => {
      expect(() => validateEnv({ NODE_ENV: 'development', SWAGGER_ENABLED: 'true' })).not.toThrow();
    });
  });
});
