import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { RolesGuard } from './common/guards/roles.guard';
import { SupabaseAuthGuard } from './common/guards/supabase-auth.guard';
import { Env, validateEnv } from './config';
import { buildLoggerParams } from './config/logger.config';
import { PrismaModule } from './infra/prisma/prisma.module';
import { QueueModule } from './infra/redis/queue.module';
import { SupabaseModule } from './infra/supabase/supabase.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { CartModule } from './modules/cart/cart.module';
import { NotificationModule } from './modules/notification/notification.module';
import { OrderModule } from './modules/order/order.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { GeoModule } from './modules/geo/geo.module';
import { HealthModule } from './modules/health/health.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { UserModule } from './modules/user/user.module';

/**
 * Modular monolith root (plan §2). New feature modules are added to `imports`;
 * they get Prisma, Supabase and the logger for free because those are global.
 *
 * Guard order matters: SupabaseAuthGuard establishes *who* is calling before
 * RolesGuard decides *whether* they may.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      envFilePath: ['.env'],
      // Tests must be hermetic: without this, a developer's local .env leaks
      // into the suite and a test that asserts unconfigured behaviour would
      // pass or fail depending on whose machine it runs on.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        buildLoggerParams({
          LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }),
          NODE_ENV: config.get('NODE_ENV', { infer: true }),
        }),
    }),

    // Outbound-proxy rate limiting. Only routes that carry @Throttle are limited; the
    // dataset endpoints read memory and stay unmetered.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => [
        {
          name: 'geocoding',
          ttl: 60_000,
          limit: config.get('GEOCODING_RATE_LIMIT', { infer: true }),
        },
      ],
    }),

    // Infrastructure
    PrismaModule,
    SupabaseModule,
    QueueModule.forRoot(),

    // Features
    HealthModule,
    AuthModule,
    CatalogModule,
    GeoModule,
    UserModule,
    AdminModule,
    InventoryModule,
    CartModule,
    OrderModule,
    NotificationModule,
  ],
  providers: [
    // Ahead of authentication: an unauthenticated flood should be rejected before it costs
    // a token verification, and the geocoding proxies are @Public().
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SupabaseAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
