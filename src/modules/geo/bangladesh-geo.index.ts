import {
  BANGLADESH_DIVISIONS,
  GeoAreaData,
  GeoDistrictData,
  GeoDivisionData,
  GeoUnitData,
} from './bangladesh-geo.data';

/**
 * Lookup key for a place name.
 *
 * Callers type "DHAKA", "dhaka " and "Dhaka"; all three must find the same row, and the
 * stored value stays the canonical spelling from the dataset. Bengali has no case, so
 * lowercasing is a no-op there and the same key function serves both languages.
 */
export const geoKey = (value: string): string => value.trim().toLowerCase();

/**
 * Unit names are NOT unique nationally — "Kaliganj" names four different upazilas — so a
 * unit is always addressed through its district.
 */
export const unitKey = (district: string, unit: string): string =>
  `${geoKey(district)}/${geoKey(unit)}`;

export interface DistrictLocation {
  readonly division: GeoDivisionData;
  readonly district: GeoDistrictData;
}

export interface UnitLocation extends DistrictLocation {
  readonly unit: GeoUnitData;
}

export interface AreaLocation extends UnitLocation {
  readonly area: GeoAreaData;
}

/**
 * Registers a row under its English name and, when the source supplied one, its Bengali
 * name too. The storefront ships in both languages and a customer may submit either, while
 * 731 rows carry only a Bengali name because no source gave an English one.
 *
 * First writer wins, so the higher-trust English spelling is never displaced by a later
 * Bengali alias.
 */
const register = <TValue>(
  map: Map<string, TValue>,
  names: readonly (string | null)[],
  value: TValue,
): void => {
  names.forEach((name) => {
    if (!name) {
      return;
    }
    const key = geoKey(name);
    if (!map.has(key)) {
      map.set(key, value);
    }
  });
};

/**
 * Registers one unit under every combination of its district's and its own names, in both
 * languages, so a caller may address it the way the customer typed it.
 *
 * Extracted rather than nested inline: four levels of nested callbacks is where this stops
 * being readable, and `sonarjs/no-nested-functions` agrees.
 */
const registerUnit = (
  map: Map<string, UnitLocation>,
  division: GeoDivisionData,
  district: GeoDistrictData,
  unit: GeoUnitData,
): void => {
  const location: UnitLocation = { division, district, unit };
  const districtNames = [district.nameEn, district.nameBn].filter((n): n is string => Boolean(n));
  const unitNames = [unit.nameEn, unit.nameBn].filter((n): n is string => Boolean(n));

  districtNames.forEach((districtName) => {
    unitNames.forEach((unitName) => {
      const key = unitKey(districtName, unitName);
      if (!map.has(key)) {
        map.set(key, location);
      }
    });
  });
};

const divisionByKey = new Map<string, GeoDivisionData>();
const districtByKey = new Map<string, DistrictLocation>();
const unitByKey = new Map<string, UnitLocation>();

BANGLADESH_DIVISIONS.forEach((division) => {
  register(divisionByKey, [division.nameEn, division.nameBn], division);

  division.districts.forEach((district) => {
    register(districtByKey, [district.nameEn, district.nameBn], { division, district });

    district.units.forEach((unit) => {
      registerUnit(unitByKey, division, district, unit);
    });
  });
});

export const DIVISION_BY_KEY: ReadonlyMap<string, GeoDivisionData> = divisionByKey;
export const DISTRICT_BY_KEY: ReadonlyMap<string, DistrictLocation> = districtByKey;
export const UNIT_BY_KEY: ReadonlyMap<string, UnitLocation> = unitByKey;

/** Finds an area inside an already-resolved unit. Area names repeat across the country. */
export const findArea = (unit: GeoUnitData, name: string): GeoAreaData | undefined => {
  const wanted = geoKey(name);
  return unit.areas.find(
    (area) =>
      geoKey(area.nameEn) === wanted || (area.nameBn !== null && geoKey(area.nameBn) === wanted),
  );
};
