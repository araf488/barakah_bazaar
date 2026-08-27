import { Env, envSchema } from './env.schema';

const ENV_VALIDATION_FAILED_MESSAGE = 'Environment validation failed:';

/**
 * Passed to `ConfigModule.forRoot({ validate })`. Throws with every problem
 * listed at once, so a misconfigured deploy is fixed in one pass.
 */
export const validateEnv = (raw: Record<string, unknown>): Env => {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`${ENV_VALIDATION_FAILED_MESSAGE}\n${details}`);
  }

  return result.data;
};
