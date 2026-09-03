/** Geo-module constants. Cross-cutting values live in app.constants.ts. */
export const GeoConstants = {
  /** Route segment this module is mounted on, under the global API prefix. */
  RouteBase: 'geo',
  /** Shorter queries match too much to be worth a provider call. */
  SearchMinLength: 2,
  SearchMaxLength: 120,
  SearchDefaultLimit: 10,
  SearchMaxLimit: 25,
  /** A pasted map link; Google's place URLs are long. */
  PastedLinkMaxLength: 2048,
} as const;

/**
 * User-facing geography messages.
 *
 * These reach an address form, so each names the link of the chain that failed —
 * "invalid address" is unactionable when four fields could be at fault.
 */
export const GeoMessages = {
  /** The value is not one of Bangladesh's eight divisions. {0} = value sent. */
  UnknownDivisionTemplate: '{0} is not a division of Bangladesh.',
  /** The value matches no district in the country. {0} = value sent. */
  UnknownDistrictTemplate: '{0} is not a district of Bangladesh.',
  /** The district exists, but not inside that division. {0} = district, {1} = division. */
  DistrictNotInDivisionTemplate: '{0} is not a district of {1}.',
  /** No upazila, thana or circle of that name in the district. {0} = unit, {1} = district. */
  UnitNotInDistrictTemplate: '{0} is not an upazila or thana of {1}.',
  /** The area does not belong to that unit. {0} = area, {1} = unit. */
  AreaNotInUnitTemplate: '{0} is not an area of {1}.',
  /** Returned when no geocoding provider is configured. */
  GeocodingDisabled: 'Map search is not available right now.',
  /** Returned when the geocoding provider could not be reached. */
  GeocodingUnavailable: 'Map search is temporarily unavailable. Please try again shortly.',
  /** Returned when a pasted link carries no usable Bangladeshi coordinates. */
  UnreadableMapLink:
    'That does not look like a Google Maps location in Bangladesh. Paste the link from the Maps share button, or drop a pin instead.',
  /** Resource label for a reverse-geocode miss. */
  LocationResourceName: 'Location',
} as const;
