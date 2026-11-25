import { Injectable } from '@nestjs/common';
import { GeocodedPlace, GeocodingProvider } from '../ports/geocoding.port';

/**
 * Map search disabled. Active while `GEOCODING_PROVIDER=noop`, and the provider the test
 * suite uses so no test ever calls a third party.
 *
 * Nothing is logged at error level: an unconfigured provider is a deliberate configuration,
 * not a fault, and logging every call would bury real errors.
 */
@Injectable()
export class NoopGeocodingGateway implements GeocodingProvider {
  readonly name = 'noop';
  readonly isConfigured = false;

  // Not declared `async`: there is nothing to await, and a real adapter awaits its HTTP call
  // while satisfying the same signature.
  search(): Promise<GeocodedPlace[] | null> {
    return Promise.resolve(null);
  }

  reverse(): Promise<GeocodedPlace | null> {
    return Promise.resolve(null);
  }
}
