/**
 * Extracts coordinates from whatever a customer pastes out of Google Maps.
 *
 * A Bangladeshi customer's building often has no meaningful street address, so pasting a
 * map link is frequently the most precise thing they can give us. Google produces several
 * shapes and the app's share sheet produces a short link, so all of them are handled.
 *
 * Pure and offline: short links need a redirect followed, which is the caller's job.
 */

/** Hosts a share link may point at. Anything else is refused before any request is made. */
const ALLOWED_HOSTS = new Set([
  'google.com',
  'www.google.com',
  'maps.google.com',
  'goo.gl',
  'maps.app.goo.gl',
  'google.com.bd',
  'www.google.com.bd',
  'maps.google.com.bd',
]);

export interface ParsedCoordinates {
  readonly latitude: number;
  readonly longitude: number;
}

/** Bangladesh's bounding box. A pin outside it is a paste error, not a delivery address. */
const BOUNDS = { minLat: 20.5, maxLat: 26.7, minLon: 88.0, maxLon: 92.7 } as const;

const withinBangladesh = ({ latitude, longitude }: ParsedCoordinates): boolean =>
  latitude >= BOUNDS.minLat &&
  latitude <= BOUNDS.maxLat &&
  longitude >= BOUNDS.minLon &&
  longitude <= BOUNDS.maxLon;

const toCoordinates = (lat: string, lon: string): ParsedCoordinates | null => {
  const latitude = Number(lat);
  const longitude = Number(lon);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
};

/**
 * The coordinate-bearing shapes, in priority order.
 *
 * `!3d…!4d` is the place's own pin and is preferred over `@…`, which is only where the
 * camera happened to sit — they differ, and the pin is what the customer chose.
 */
const PATTERNS: readonly RegExp[] = [
  /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
  /[?&](?:q|query|ll|center|daddr)=(-?\d+\.\d+)%2C\s*(-?\d+\.\d+)/i,
  /[?&](?:q|query|ll|center|daddr)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/i,
  /@(-?\d+\.\d+),(-?\d+\.\d+)/,
  /^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/,
];

export const GoogleMapsLink = {
  /**
   * True when the input is a URL we may follow. Used to gate the outbound request — a
   * customer-supplied URL is an SSRF vector, so only Google's own hosts are ever fetched.
   */
  isFollowableUrl(input: string): boolean {
    try {
      const url = new URL(input.trim());
      return (
        (url.protocol === 'https:' || url.protocol === 'http:') && ALLOWED_HOSTS.has(url.hostname)
      );
    } catch {
      return false;
    }
  },

  /** True for the shortened forms that carry no coordinates until they are resolved. */
  isShortLink(input: string): boolean {
    try {
      const url = new URL(input.trim());
      return url.hostname === 'goo.gl' || url.hostname === 'maps.app.goo.gl';
    } catch {
      return false;
    }
  },

  /**
   * Pulls coordinates out of a pasted link or a bare "lat, lng" pair.
   *
   * Returns null when there are none to find, or when the pin is outside Bangladesh — we
   * deliver here, and a pin in the Atlantic is a mis-paste we should reject rather than
   * store.
   */
  parse(input: string): ParsedCoordinates | null {
    const text = input.trim();

    for (const pattern of PATTERNS) {
      const match = pattern.exec(text);

      if (match) {
        const parsed = toCoordinates(match[1], match[2]);

        if (parsed && withinBangladesh(parsed)) {
          return parsed;
        }
      }
    }

    return null;
  },
} as const;
