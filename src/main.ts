import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { installBigIntJsonSerializer } from './common/money/bigint-serializer';
import { ApplicationConstants } from './common/constants/app.constants';
import { CorsPolicyConfigurator } from './common/cors/cors-policy.configurator';
import { ConfigService } from '@nestjs/config';
import { AppConfigService } from './config';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // Must run before anything can serialize a Prisma BigInt column.
  installBigIntJsonSerializer();

  // bufferLogs holds startup output until pino replaces the default logger, so
  // boot lines land in the same structured stream as everything else.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
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

  // Lets onModuleDestroy hooks close the Prisma pool on SIGTERM.
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  logger.log(
    `${ApplicationConstants.ServiceName} listening on port ${port} at /${apiPrefix}/${apiVersion} (allowed origins: ${allowedOrigins.length})`,
  );
}

void bootstrap();
