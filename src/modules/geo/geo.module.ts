import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../config';
import { GeoapifyGeocodingGateway } from './gateways/geoapify-geocoding.gateway';
import { NoopGeocodingGateway } from './gateways/noop-geocoding.gateway';
import { PhotonGeocodingGateway } from './gateways/photon-geocoding.gateway';
import { GeoController } from './geo.controller';
import { GeoService } from './geo.service';
import { GeoTokens, GeocodingProvider } from './ports/geocoding.port';

/**
 * Chooses the geocoding adapter from `GEOCODING_PROVIDER`.
 *
 * Geoapify without a key falls back to noop rather than making calls that would 401 — a
 * misconfiguration should disable map search, not fail every request at the provider.
 */
export const createGeocodingProvider = (
  config: AppConfigService,
  logger: PinoLogger,
): GeocodingProvider => {
  const provider = config.get('GEOCODING_PROVIDER', { infer: true });

  if (provider === 'photon') {
    return new PhotonGeocodingGateway(config.get('PHOTON_API_URL', { infer: true }), logger);
  }

  if (provider === 'geoapify') {
    const key = config.get('GEOAPIFY_API_KEY', { infer: true });
    const gateway = new GeoapifyGeocodingGateway(
      config.get('GEOAPIFY_API_URL', { infer: true }),
      key,
      logger,
    );
    return gateway.isConfigured ? gateway : new NoopGeocodingGateway();
  }

  return new NoopGeocodingGateway();
};

/**
 * Bangladesh reference geography, plus the map-search proxy.
 *
 * Exports GeoService because address writes (UserModule) and, later, delivery routing both
 * validate against the same dataset — the alternative is two copies that drift.
 */
@Module({
  controllers: [GeoController],
  providers: [
    GeoService,
    {
      provide: GeoTokens.GeocodingProvider,
      inject: [ConfigService, PinoLogger],
      useFactory: createGeocodingProvider,
    },
  ],
  exports: [GeoService],
})
export class GeoModule {}
