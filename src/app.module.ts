import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuthThrottlerGuard } from './common/guards/auth-throttler.guard';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { RolesGuard } from './common/guards/roles.guard';
import { SessionAuthGuard } from './common/guards/session-auth.guard';
import { Env, validateEnv } from './config';
import { buildLoggerParams } from './config/logger.config';
import { buildThrottlerOptions } from './config/throttler.config';
import { PrismaModule } from './infra/prisma/prisma.module';
import { QueueModule } from './infra/redis/queue.module';
import { SupabaseModule } from './infra/supabase/supabase.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { CartModule } from './modules/cart/cart.module';
import { NotificationModule } from './modules/notification/notification.module';
import { OrderModule } from './modules/order/order.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { PaymentModule } from './modules/payment/payment.module';
import { PromotionModule } from './modules/promotion/promotion.module';
import { ReviewModule } from './modules/review/review.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { GeoModule } from './modules/geo/geo.module';
import { HealthModule } from './modules/health/health.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { UserModule } from './modules/user/user.module';

/**
 * Modular monolith root (plan §2). New feature modules are added to `imports`;
 * they get Prisma, Supabase and the logger for free because those are global.
 *
 * Guard order matters: SessionAuthGuard establishes *who* is calling — from this
 * application's own session, not a third-party token — before RolesGuard decides *whether*
 * they may.
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

    // Named rate-limit buckets, applied by AuthThrottlerGuard below. 'geocoding' guards the
    // outbound map-search proxies and 'auth' guards login and MFA verification against brute
    // force, both only where a route asks with @RateLimit; 'writes' is the baseline ceiling
    // on every state-changing request, and reads are left unlimited at this layer.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        buildThrottlerOptions({
          GEOCODING_RATE_LIMIT: config.get('GEOCODING_RATE_LIMIT', { infer: true }),
          AUTH_RATE_LIMIT: config.get('AUTH_RATE_LIMIT', { infer: true }),
          WRITE_RATE_LIMIT: config.get('WRITE_RATE_LIMIT', { infer: true }),
        }),
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
    PaymentModule,
    DeliveryModule,
    PromotionModule,
    ReviewModule,
  ],
  providers: [
    // Ahead of authentication: an unauthenticated flood should be rejected before it costs
    // a token verification, and the geocoding proxies are @Public(). AuthThrottlerGuard
    // replaces the library's default ThrottlerGuard so every named bucket — 'geocoding' and
    // 'auth' alike — is tracked by IP+email rather than IP alone; see its class comment.
    // It runs on every request, but each bucket applies only where @RateLimit names it.
    { provide: APP_GUARD, useClass: AuthThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
