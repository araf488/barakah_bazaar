import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { GeocodedPlace, GeocodingProvider } from '../ports/geocoding.port';
import { JsonFetcher, fetchJson } from './json-fetcher';

interface GeoapifyFeature {
  properties?: Record<string, unknown>;
}

/**
 * Geoapify — the managed fallback for when Photon throttles.
 *
 * Needs a key, so `isConfigured` is false without one and the module falls back to noop
 * rather than making calls that would 401. The key is never logged.
 */
@Injectable()
export class GeoapifyGeocodingGateway implements GeocodingProvider {
  readonly name = 'geoapify';

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly logger: PinoLogger,
    private readonly fetcher: JsonFetcher = fetchJson,
  ) {}

  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async search(query: string, limit: number): Promise<GeocodedPlace[] | null> {
    try {
      const url =
        `${this.baseUrl}/v1/geocode/autocomplete?text=${encodeURIComponent(query)}` +
        `&limit=${limit}&filter=countrycode:bd&apiKey=${encodeURIComponent(this.apiKey ?? '')}`;

      return GeoapifyGeocodingGateway.toPlaces(await this.fetcher(url));
    } catch (error) {
      // Neither the query nor the URL is logged — the URL carries the API key.
      this.logger.error(
        { err: error, provider: this.name },
        'Exception occurred in GeoapifyGeocodingGateway.search',
      );
      return null;
    }
  }

  async reverse(latitude: number, longitude: number): Promise<GeocodedPlace | null> {
    try {
      const url =
        `${this.baseUrl}/v1/geocode/reverse?lat=${latitude}&lon=${longitude}` +
        `&apiKey=${encodeURIComponent(this.apiKey ?? '')}`;
      const places = GeoapifyGeocodingGateway.toPlaces(await this.fetcher(url));

      return places.at(0) ?? null;
    } catch (error) {
      this.logger.error(
        { err: error, provider: this.name },
        'Exception occurred in GeoapifyGeocodingGateway.reverse',
      );
      return null;
    }
  }

  private static toPlaces(payload: unknown): GeocodedPlace[] {
    const features = (payload as { features?: unknown })?.features;

    if (!Array.isArray(features)) {
      return [];
    }

    return features
      .map((feature) => GeoapifyGeocodingGateway.toPlace(feature as GeoapifyFeature))
      .filter((place): place is GeocodedPlace => place !== null);
  }

  /** Geoapify puts numeric lat/lon in `properties`, unlike Photon's GeoJSON geometry. */
  private static toPlace(feature: GeoapifyFeature): GeocodedPlace | null {
    const properties = feature.properties ?? {};
    const latitude = Number(properties.lat);
    const longitude = Number(properties.lon);
    const label = properties.formatted;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    if (typeof label !== 'string' || label.length === 0) {
      return null;
    }

    const postCode = properties.postcode;

    return {
      label,
      latitude,
      longitude,
      postCode: typeof postCode === 'string' ? postCode : null,
    };
  }
}
