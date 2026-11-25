/** A point on the earth, or nothing — coordinates are optional throughout this system. */
export interface Coordinates {
  readonly latitude: number | null;
  readonly longitude: number | null;
}

/**
 * Whether a hub can serve an address, and how confidently.
 *
 * `unknown` is a real answer, not a failure. Addresses carry coordinates only when the
 * customer pasted a map link, so a large share of orders cannot be measured at all — and a
 * system that treated "cannot measure" as "too far" would refuse most legitimate orders.
 */
export type Reach = 'within' | 'too-far' | 'unknown';

const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance in kilometres. Null when either point lacks coordinates. */
export const distanceKm = (from: Coordinates, to: Coordinates): number | null => {
  if (
    from.latitude === null ||
    from.longitude === null ||
    to.latitude === null ||
    to.longitude === null
  ) {
    return null;
  }

  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(dLon / 2) ** 2;

  return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(a));
};

/**
 * Whether `to` is inside `limitKm` of `from`.
 *
 * A null limit means no limit — the product or hub declares no cap, so nothing to enforce.
 */
export const reachWithin = (from: Coordinates, to: Coordinates, limitKm: number | null): Reach => {
  if (limitKm === null) {
    return 'within';
  }

  const measured = distanceKm(from, to);

  if (measured === null) {
    return 'unknown';
  }

  return measured <= limitKm ? 'within' : 'too-far';
};
