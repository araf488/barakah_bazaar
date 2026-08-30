/** Injection token for the configured geocoding provider. */
export const GeoTokens = {
  GeocodingProvider: Symbol('BARAKAH_GEOCODING_PROVIDER'),
  /** Follows a shortened map link. A token, not a default parameter: Nest cannot resolve a
   *  defaulted constructor argument and fails at boot trying to inject it. */
  UrlResolver: Symbol('BARAKAH_URL_RESOLVER'),
} as const;

/** One place a geocoder returned. Only the coordinates are ever persisted. */
export interface GeocodedPlace {
  /** Display string in the provider's own language — shown back for confirmation only. */
  readonly label: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly postCode?: string | null;
}

/**
 * Outbound geocoding port.
 *
 * The seam a Photon, Geoapify or Barikoi adapter drops into without touching calling code.
 * Proxied server-side so an API key never reaches the browser or the app.
 *
 * `null` means the call FAILED — the service turns that into a 503. An empty array means
 * "searched, found nothing", which is a 200 with `[]`. Collapsing the two would report a
 * provider outage as "no results", and the customer would retype their address forever.
 */
export interface GeocodingProvider {
  /** 'noop' | 'photon' | 'geoapify' — surfaced in logs and /health. */
  readonly name: string;
  /** False when no provider is configured; drives the 503 and the health report. */
  readonly isConfigured: boolean;
  search(query: string, limit: number): Promise<GeocodedPlace[] | null>;
  reverse(latitude: number, longitude: number): Promise<GeocodedPlace | null>;
}
