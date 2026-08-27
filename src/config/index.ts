import { ConfigService } from '@nestjs/config';
import { Env } from './env.schema';

export { Env } from './env.schema';
export { envSchema } from './env.schema';
export { validateEnv } from './validate-env';

/**
 * Typed ConfigService. `true` marks the config as validated, so `get('PORT')`
 * is non-nullable and a typo'd key fails at compile time.
 *
 * A type alias, deliberately — subclassing ConfigService would create a DI
 * token nothing provides.
 *
 * Because an alias has no runtime value, `emitDecoratorMetadata` records
 * `undefined` for a parameter annotated with it, so every injection site must
 * name the token explicitly:
 *
 *     constructor(@Inject(ConfigService) private readonly config: AppConfigService) {}
 *
 * Removing that `@Inject` compiles cleanly and then fails at startup with
 * "can't resolve dependencies ... argument at index [0]".
 */
export type AppConfigService = ConfigService<Env, true>;
