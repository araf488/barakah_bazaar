export const DeliveryConstants = {
  RouteBase: 'delivery',
  AdminRouteBase: 'admin/delivery/zones',
  ZoneResourceName: 'Delivery zone',
  MaxZoneNameLength: 80,
  /** A zone with more rules than this is almost certainly modelled the wrong way round. */
  MaxRulesPerZone: 500,
  MaxPageSize: 100,
  /** How far ahead delivery windows are offered. */
  SlotHorizonDays: 7,
  MaxSlotHorizonDays: 14,
  DefaultPageSize: 50,
} as const;

export const DeliveryMessages = {
  /** No zone matched and none is marked default. */
  NoZoneConfigured: 'Delivery is not available to that address yet. Please contact support.',
  /** A second zone was marked default. */
  DefaultZoneExists: 'Another zone is already the default. Clear it before marking this one.',
  /** The place named in a rule is not in the geography dataset. */
  UnknownPlace: 'That place is not in the address dataset. Check the spelling.',
  /** A rule named a unit without naming its district. */
  UnitNeedsDistrict: 'A rule naming a unit must also name its district.',
  /** A rule named a district without naming its division. */
  DistrictNeedsDivision: 'A rule naming a district must also name its division.',
  /** The same place is already claimed by another zone. */
  PlaceAlreadyZoned: 'That place already belongs to another delivery zone.',
  /** The chosen window has since filled or closed. */
  SlotUnavailable: 'That delivery slot is no longer available. Please choose another.',
  /** A perishable basket was sent to a window without cold transport. */
  SlotNotCold:
    'That delivery slot cannot keep chilled items cold. Please choose a cold-chain slot.',
  /** The window does not belong to the hub that will pack the order. */
  SlotWrongHub: 'That delivery slot is not offered for this order.',
  /** A window that ends before it starts. */
  SlotWindowInverted: 'A delivery window must end after it starts.',
  /** A cutoff so long the window closes before the day it runs. */
  SlotCutoffTooEarly:
    'The cutoff is longer than the time before the window opens, so it could never be booked.',
  /** The database could not be read or written. */
  Unavailable: 'Could not load delivery pricing. Please try again.',
  /** The audit row could not be written, so the change was refused. */
  AuditTrailUnavailable: 'Could not record this change in the audit trail, so it was not applied.',
} as const;
