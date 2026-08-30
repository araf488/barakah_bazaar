import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApplicationConstants } from './common/constants/app.constants';
import { SERVICE_VERSION } from './common/service-version';

/**
 * Mounts the OpenAPI document. The storefront, admin portal and Flutter app all
 * consume this contract, so it is the shared source of truth for DTO shapes —
 * generate clients from it rather than hand-writing models.
 */
export const setupSwagger = (app: INestApplication, path: string): void => {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle(ApplicationConstants.ServiceName)
      .setDescription(ApplicationConstants.ServiceDescription)
      .setVersion(SERVICE_VERSION)
      .addBearerAuth({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Supabase Auth access token',
      })
      .addTag('Health', 'Liveness and readiness probes')
      .addTag('Auth', 'Session exchange and the current user')
      .addTag('Catalog', 'Public browsing of categories and products')
      .addTag('Geo', 'Bangladesh division, district, upazila/thana and area lookups')
      .addTag('Users', 'The current customer: profile and delivery addresses')
      .addTag('Cart', "The signed-in customer's basket")
      .addTag('Admin', 'Backoffice: audit trail, catalog and staff management')
      .build(),
  );

  SwaggerModule.setup(path, app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
};
