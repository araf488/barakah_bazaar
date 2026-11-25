import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { GeocodedPlace, GeocodingProvider } from '../ports/geocoding.port';
import { JsonFetcher, fetchJson } from './json-fetcher';

/** Centre of Dhaka, used to bias results towards where the customers are. */
const BIAS = { lat: 23.8103, lon: 90.4125, zoom: 7 } as const;

interface PhotonFeature {
  geometry?: { coordinates?: unknown };
  properties?: Record<string, unknown>;
}

/**
 * Photon (photon.komoot.io) — OpenStreetMap-backed, free and keyless.
 *
 * Chosen as the default because it needs no account and was the only provider verified
 * against real Dhaka queries. It returns Bengali place names natively, which suits the
 * bilingual storefront.
 *
 * Only coordinates are ever persisted from this; the administrative address always comes
 * from the vendored dataset, so Photon's own naming never reaches the database.
 */
@Injectable()
export class PhotonGeocodingGateway implements GeocodingProvider {
  readonly name = 'photon';
  /** Photon needs no key, so it is configured whenever a base URL exists. */
  readonly isConfigured = true;

  constructor(
    private readonly baseUrl: string,
    private readonly logger: PinoLogger,
    private readonly fetcher: JsonFetcher = fetchJson,
  ) {}

  async search(query: string, limit: number): Promise<GeocodedPlace[] | null> {
    try {
      const url =
        `${this.baseUrl}/api?q=${encodeURIComponent(query)}&limit=${limit}` +
        `&lat=${BIAS.lat}&lon=${BIAS.lon}&zoom=${BIAS.zoom}`;

      return PhotonGeocodingGateway.toPlaces(await this.fetcher(url));
    } catch (error) {
      // The query is not logged: a search string is customer-entered and may carry
      // personal detail. The provider name is enough to diagnose an outage.
      this.logger.error(
        { err: error, provider: this.name },
        'Exception occurred in PhotonGeocodingGateway.search',
      );
      return null;
    }
  }

  async reverse(latitude: number, longitude: number): Promise<GeocodedPlace | null> {
    try {
      const url = `${this.baseUrl}/reverse?lat=${latitude}&lon=${longitude}`;
      const places = PhotonGeocodingGateway.toPlaces(await this.fetcher(url));

      return places.at(0) ?? null;
    } catch (error) {
      this.logger.error(
        { err: error, provider: this.name },
        'Exception occurred in PhotonGeocodingGateway.reverse',
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
      .map((feature) => PhotonGeocodingGateway.toPlace(feature as PhotonFeature))
      .filter((place): place is GeocodedPlace => place !== null);
  }

  private static toPlace(feature: PhotonFeature): GeocodedPlace | null {
    const coordinates = feature.geometry?.coordinates;
    const properties = feature.properties ?? {};

    // GeoJSON orders coordinates [longitude, latitude]. Reading them the other way round
    // puts every Bangladeshi address in Somalia.
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return null;
    }

    const longitude = Number(coordinates[0]);
    const latitude = Number(coordinates[1]);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    const country = properties.countrycode;
    if (typeof country === 'string' && country.toUpperCase() !== 'BD') {
      return null;
    }

    const label = ['name', 'street', 'district', 'city']
      .map((key) => properties[key])
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(', ');

    if (!label) {
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
