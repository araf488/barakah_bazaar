import { resolve } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { installBigIntJsonSerializer } from './common/money/bigint-serializer';
import { ApplicationConstants } from './common/constants/app.constants';
import { CorsPolicyConfigurator } from './common/cors/cors-policy.configurator';
import { ConfigService } from '@nestjs/config';
import { AppConfigService } from './config';
import { AppModule } from './app.module';
import { mountWeb, shouldMountWeb, webMountOptionsFrom } from './web/web-mount';
import { WebMountState } from './web/web-mount-state';

async function bootstrap(): Promise<void> {
  // Must run before anything can serialize a Prisma BigInt column.
  installBigIntJsonSerializer();

  // bufferLogs holds startup output until pino replaces the default logger, so
  // boot lines land in the same structured stream as everything else.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  const config: AppConfigService = app.get(ConfigService);
  const apiPrefix = config.get('API_PREFIX', { infer: true });
  const apiVersion = config.get('API_VERSION', { infer: true });

  app.setGlobalPrefix(`${apiPrefix}/${apiVersion}`);

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip unknown properties and reject the request if any were sent, so a
      // client cannot smuggle fields past a DTO.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const allowedOrigins = CorsPolicyConfigurator.parseAllowedOrigins(
    config.get('CORS_ALLOWED_ORIGINS', { infer: true }),
  );
  app.enableCors(CorsPolicyConfigurator.build(allowedOrigins));

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    const { setupSwagger } = await import('./swagger');
    setupSwagger(app, `${apiPrefix}/${ApplicationConstants.SwaggerPath}`);
  }

  // Storefront + admin SPA. Express middleware added here, before listen() runs init, sits in
  // front of Nest's router: API paths pass through to it, web paths never reach a guard.
  // dist/main.js and src/main.ts both sit one level below the repository root.
  if (shouldMountWeb(config)) {
    await mountWeb(app, webMountOptionsFrom(config, resolve(__dirname, '..')));
    app.get(WebMountState).markPrepared();
  }

  // Lets onModuleDestroy hooks close the Prisma pool on SIGTERM.
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  logger.log(
    `${ApplicationConstants.ServiceName} listening on port ${port} at /${apiPrefix}/${apiVersion} (allowed origins: ${allowedOrigins.length})`,
  );
}

void bootstrap();
