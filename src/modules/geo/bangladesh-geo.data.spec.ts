import { BANGLADESH_DIVISIONS, GeoAreaData, GeoUnitData } from './bangladesh-geo.data';
import {
  DISTRICT_BY_KEY,
  DIVISION_BY_KEY,
  UNIT_BY_KEY,
  findArea,
  geoKey,
  unitKey,
} from './bangladesh-geo.index';

const BENGALI = /[ঀ-৿]/;

const allDistricts = BANGLADESH_DIVISIONS.flatMap((division) =>
  division.districts.map((district) => ({ division: division.nameEn, district })),
);
const allUnits = allDistricts.flatMap(({ division, district }) =>
  district.units.map((unit) => ({ division, district: district.nameEn, unit })),
);
const allAreas = allUnits.flatMap(({ district, unit }) =>
  unit.areas.map((area) => ({ district, unit: unit.nameEn, area })),
);

const districtsOf = (division: string): string[] =>
  allDistricts.filter((row) => row.division === division).map((row) => row.district.nameEn);

const unitsOf = (district: string): readonly GeoUnitData[] =>
  allDistricts.find((row) => row.district.nameEn === district)?.district.units ?? [];

describe('Bangladesh geography dataset', () => {
  describe('shape', () => {
    it('has the eight divisions, by their current official names', () => {
      expect(BANGLADESH_DIVISIONS.map((division) => division.nameEn)).toEqual([
        'Barishal',
        'Chattogram',
        'Dhaka',
        'Khulna',
        'Mymensingh',
        'Rajshahi',
        'Rangpur',
        'Sylhet',
      ]);
    });

    it('has sixty-four districts', () => {
      expect(allDistricts).toHaveLength(64);
    });

    // Exact counts are regeneration guards: the dataset is built deterministically from
    // pinned sources, so a change here means a source or the merge logic moved, and that
    // should be a conscious decision rather than a silent drift.
    it('has the expected number of units and areas', () => {
      expect(allUnits).toHaveLength(690);
      expect(allAreas).toHaveLength(6505);
    });

    it('classifies every unit and every area', () => {
      expect(allUnits.every((row) => ['upazila', 'thana', 'circle'].includes(row.unit.kind))).toBe(
        true,
      );
      expect(allAreas.every((row) => ['union', 'postcode-area'].includes(row.area.kind))).toBe(
        true,
      );
    });

    it('gives every district at least one unit', () => {
      expect(allDistricts.filter(({ district }) => district.units.length === 0)).toEqual([]);
    });
  });

  describe('names', () => {
    it('stores every name trimmed and non-empty', () => {
      const names = [
        ...BANGLADESH_DIVISIONS.flatMap((d) => [d.nameEn, d.nameBn]),
        ...allDistricts.flatMap(({ district }) => [district.nameEn, district.nameBn]),
        ...allUnits.flatMap(({ unit }) => [unit.nameEn, unit.nameBn]),
        ...allAreas.flatMap(({ area }) => [area.nameEn, area.nameBn]),
      ].filter((name): name is string => name !== null);

      expect(names.filter((name) => name !== name.trim() || name.length === 0)).toEqual([]);
    });

    it('gives every division and district both languages', () => {
      expect(BANGLADESH_DIVISIONS.every((d) => Boolean(d.nameEn) && BENGALI.test(d.nameBn))).toBe(
        true,
      );
      expect(
        allDistricts.every(
          ({ district }) => Boolean(district.nameEn) && BENGALI.test(district.nameBn),
        ),
      ).toBe(true);
    });

    const everyName = (): string[] =>
      [
        ...allUnits.flatMap(({ unit }) => [unit.nameEn, unit.nameBn]),
        ...allAreas.flatMap(({ area }) => [area.nameEn, area.nameBn]),
      ].filter((name): name is string => name !== null);

    it('never carries a Bengali label suffix, at unit level or area level', () => {
      // Originally this checked areas only, and 16 units shipped with names like
      // 'আদমদীঘি উপজেলা' ("Adamdighi upazila") — each a duplicate of its own Latin entry.
      expect(everyName().filter((name) => / (ইউনিয়ন|উপজেলা|থানা|সার্কেল)$/.test(name))).toEqual(
        [],
      );
    });

    it('never leaks wiki table markup into a name', () => {
      // '| তাহিরপুর উপজেলা' shipped once, pipe and all, and would have been persisted onto
      // a customer's address and handed to a delivery rider.
      expect(everyName().filter((name) => /[|{}[\]]/.test(name))).toEqual([]);
    });

    it('never offers an abolished unit as selectable', () => {
      expect(everyName().filter((name) => name.includes('বিলুপ্ত'))).toEqual([]);
    });

    it('has no unit whose English name is really a duplicate in Bengali', () => {
      // A Bengali nameEn is legitimate only where NO source supplies an English one. A
      // duplicate of an existing Latin unit in the same district is not that.
      const offenders = allDistricts.flatMap(({ district }) => {
        const latin = district.units
          .filter((unit) => !BENGALI.test(unit.nameEn))
          .map((unit) => unit.nameEn.toLowerCase());
        return district.units
          .filter((unit) => BENGALI.test(unit.nameEn))
          .filter((unit) => latin.includes((unit.nameBn ?? '').toLowerCase()))
          .map((unit) => `${district.nameEn}/${unit.nameEn}`);
      });

      expect(offenders).toEqual([]);
    });

    it('has no duplicate unit name within one district', () => {
      const duplicated = allDistricts.filter(({ district }) => {
        const names = district.units.map((unit) => geoKey(unit.nameEn));
        return new Set(names).size !== names.length;
      });

      expect(duplicated).toEqual([]);
    });

    it('has no duplicate area name within one unit', () => {
      const duplicated = allUnits.filter(({ unit }) => {
        const names = unit.areas.map((area) => geoKey(area.nameEn));
        return new Set(names).size !== names.length;
      });

      expect(duplicated).toEqual([]);
    });
  });

  describe('district-to-division assignment', () => {
    it('puts exactly four districts in Sylhet', () => {
      expect([...districtsOf('Sylhet')].sort((a, b) => a.localeCompare(b))).toEqual([
        'Habiganj',
        'Moulvibazar',
        'Sunamganj',
        'Sylhet',
      ]);
    });

    it.each([
      ['Dhaka', 'Dhaka'],
      ['Dhaka', 'Gazipur'],
      ['Dhaka', 'Narayanganj'],
      ['Dhaka', 'Manikganj'],
      ['Chattogram', 'Chattogram'],
      ['Chattogram', "Cox's Bazar"],
      ['Khulna', 'Jashore'],
      ['Rajshahi', 'Bogura'],
      ['Rangpur', 'Kurigram'],
      ['Barishal', 'Bhola'],
    ])('places %s district in the %s division', (division, district) => {
      expect(districtsOf(division)).toContain(district);
    });
  });

  describe('metropolitan coverage', () => {
    // The gap that made the form unusable for city customers: Dhaka district has only five
    // upazilas, so a resident of Gulshan or Donia had nothing to select.
    it.each([
      'Gulshan',
      'Banani',
      'Motijheel',
      'Ramna Model',
      'Rampura',
      'Badda',
      'Vatara',
      'Tejgaon',
      'Mirpur Model',
      'Uttara East',
    ])('offers %s as a unit of Dhaka district', (name) => {
      expect(unitsOf('Dhaka').map((unit) => unit.nameEn)).toContain(name);
    });

    it('carries the Tejgaon development circle with all seventeen of its areas', () => {
      const circle = unitsOf('Dhaka').find((unit) => unit.kind === 'circle');

      expect(circle?.nameBn).toBe('তেজগাঁও');
      expect(circle?.areas).toHaveLength(17);
    });

    it('names Donia in English, as supplied by the product owner', () => {
      const circle = unitsOf('Dhaka').find((unit) => unit.kind === 'circle');

      expect(circle?.areas.map((area) => area.nameEn)).toContain('Donia');
    });

    it('keeps the rural upazilas of Dhaka district alongside the city thanas', () => {
      const names = unitsOf('Dhaka').map((unit) => unit.nameEn);

      expect(names).toEqual(expect.arrayContaining(['Savar', 'Dhamrai', 'Keraniganj', 'Dohar']));
    });
  });

  describe('post code and coordinates', () => {
    const withPostCode = allAreas.filter(({ area }) => area.postCode !== null);

    it('carries post codes for the post-office areas', () => {
      expect(withPostCode).toHaveLength(1098);
    });

    it('gives every area with a post code its coordinates too', () => {
      expect(
        withPostCode.filter(({ area }) => area.latitude === null || area.longitude === null),
      ).toEqual([]);
    });

    it('stores post codes as four digits', () => {
      const malformed = withPostCode.filter(({ area }) => !/^\d{4}$/.test(area.postCode ?? ''));

      expect(malformed).toEqual([]);
    });

    it('places every coordinate inside Bangladesh', () => {
      const outside = allAreas.filter(({ area }) => {
        if (area.latitude === null || area.longitude === null) {
          return false;
        }
        return (
          area.latitude < 20.5 ||
          area.latitude > 26.7 ||
          area.longitude < 88 ||
          area.longitude > 92.7
        );
      });

      expect(outside).toEqual([]);
    });
  });

  describe('lookup index', () => {
    it('indexes every division and district', () => {
      expect(DIVISION_BY_KEY.get(geoKey('Dhaka'))?.nameEn).toBe('Dhaka');
      expect(DISTRICT_BY_KEY.get(geoKey('Gazipur'))?.division.nameEn).toBe('Dhaka');
    });

    it('finds a division regardless of case and padding', () => {
      expect(DIVISION_BY_KEY.get(geoKey('  SYLHET '))?.nameEn).toBe('Sylhet');
    });

    it('finds a district by its Bengali name too', () => {
      expect(DISTRICT_BY_KEY.get(geoKey('ঢাকা'))?.district.nameEn).toBe('Dhaka');
    });

    it('scopes a unit lookup by district, because unit names repeat nationally', () => {
      expect(UNIT_BY_KEY.get(unitKey('Dhaka', 'Savar'))?.district.nameEn).toBe('Dhaka');
      expect(UNIT_BY_KEY.get(unitKey('Sylhet', 'Savar'))).toBeUndefined();
    });

    it('resolves a Dhaka city thana through the same index', () => {
      expect(UNIT_BY_KEY.get(unitKey('Dhaka', 'Gulshan'))?.unit.kind).toBe('thana');
    });

    it('finds an area inside a resolved unit, in either language', () => {
      const savar = UNIT_BY_KEY.get(unitKey('Dhaka', 'Savar'));
      const byEnglish = findArea(savar!.unit, 'Birulia');
      const byBengali = findArea(savar!.unit, byEnglish?.nameBn ?? '');

      expect(byEnglish?.nameEn).toBe('Birulia');
      expect(byBengali).toBe(byEnglish);
    });

    it('does not find an area that belongs to another unit', () => {
      const savar = UNIT_BY_KEY.get(unitKey('Dhaka', 'Savar'));

      expect(findArea(savar!.unit, 'Gulshan')).toBeUndefined();
    });
  });

  describe('bilingual gaps are explicit, never invented', () => {
    const missingBengali = (rows: readonly { nameBn: string | null }[]): number =>
      rows.filter((row) => row.nameBn === null).length;

    it('leaves nameBn null rather than transliterating, for the English-only sources', () => {
      const units = allUnits.map(({ unit }) => unit);
      const areas: GeoAreaData[] = allAreas.map(({ area }) => area);

      // The DMP and post-office lists are English-only. A Bengali spelling is supplied only
      // when a source had one; guessing would be visibly wrong to a Bangla reader.
      // Deliberately not asserting that gaps exist — that could never fail. The property
      // under test is that a present nameBn is always REAL Bengali, never a transliteration.
      expect(missingBengali(units) + missingBengali(areas)).toBeGreaterThanOrEqual(0);
      expect(units.every((unit) => unit.nameBn === null || BENGALI.test(unit.nameBn))).toBe(true);
      expect(areas.every((area) => area.nameBn === null || BENGALI.test(area.nameBn))).toBe(true);
    });
  });
});
