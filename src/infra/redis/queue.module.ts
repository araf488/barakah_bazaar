import { DynamicModule, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Env } from '../../config';

/**
 * BullMQ wiring for async work — order-confirmation SMS, invoice generation,
 * courier sync, expiry alerts. Supabase provides no job queue, so this stays a
 * separate piece of infrastructure.
 *
 * Off unless `QUEUE_ENABLED=true`, so local development and CI need no Redis.
 * Feature modules register their own queues with `BullModule.registerQueue()`
 * and must tolerate the queue being absent.
 */
@Module({})
export class QueueModule {
  static forRoot(): DynamicModule {
    const enabled = process.env.QUEUE_ENABLED === 'true';

    if (!enabled) {
      return { module: QueueModule, imports: [], exports: [] };
    }

    return {
      module: QueueModule,
      imports: [
        BullModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService<Env, true>) => ({
            connection: {
              host: config.get('REDIS_HOST', { infer: true }),
              port: config.get('REDIS_PORT', { infer: true }),
              password: config.get('REDIS_PASSWORD', { infer: true }),
              ...(config.get('REDIS_TLS', { infer: true }) ? { tls: {} } : {}),
            },
          }),
        }),
      ],
      exports: [BullModule],
    };
  }
}
