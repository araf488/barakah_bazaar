/** Geo-module constants. Cross-cutting values live in app.constants.ts. */
export const GeoConstants = {
  /** Route segment this module is mounted on, under the global API prefix. */
  RouteBase: 'geo',
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
} as const;
