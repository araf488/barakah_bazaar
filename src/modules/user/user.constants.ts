/** User-module constants. Cross-cutting values live in app.constants.ts. */
export const UserConstants = {
  /** Route segment the profile controller is mounted on. */
  RouteBase: 'users',
  /** Route segment the address controller is mounted on. */
  AddressRouteBase: 'users/me/addresses',
  /** Resource label used in not-found messages about an address. */
  AddressResourceName: 'Address',
  /** Addresses one customer may keep. An unbounded book is a spam vector. */
  MaxAddressesPerUser: 20,
  MaxFullNameLength: 120,
  MaxLabelLength: 40,
  MaxRecipientNameLength: 120,
  MaxAddressLineLength: 255,
  /**
   * Longest division, district, unit or area name the vendored dataset can hold. Generous
   * because the dataset carries Bengali names too, and a Bengali place name is longer in
   * characters than its English form.
   */
  MaxGeoNameLength: 80,
} as const;

/** Bangladeshi post codes are four digits. */
export const POST_CODE_PATTERN = /^\d{4}$/;

/**
 * User-facing messages this module owns. Geography messages belong to GeoModule, which is
 * what produces them.
 */
export const UserMessages = {
  /** Returned when a create would exceed the address cap. {0} = the cap. */
  AddressLimitReachedTemplate:
    'You can save at most {0} addresses. Remove one before adding another.',
} as const;
