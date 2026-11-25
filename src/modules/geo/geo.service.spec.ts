import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../test/support/mocks';
import { GeoResolveLinkDto, GeoReverseQueryDto, GeoSearchQueryDto } from './dto/geocoding.dto';
import { NoopGeocodingGateway } from './gateways/noop-geocoding.gateway';
import { GeoService } from './geo.service';

describe('GeoService', () => {
  let logger: jest.Mocked<PinoLogger>;
  let service: GeoService;

  beforeEach(() => {
    logger = createMockLogger();
    service = new GeoService(new NoopGeocodingGateway(), logger, jest.fn());
  });

  /** Reads a real area name out of the dataset rather than hard-coding a second copy. */
  const firstAreaOf = (district: string, unit: string): string => {
    const result = service.listAreas(district, unit);
    if (!result.ok) {
      throw new Error(`fixture ${district}/${unit} missing from the dataset`);
    }
    return result.data.areas[0].nameEn;
  };

  describe('listDivisions', () => {
    it('returns all eight divisions in both languages', () => {
      const result = service.listDivisions();

      expect(result.ok && result.data).toHaveLength(8);
      expect(result.ok && result.data.find((d) => d.nameEn === 'Dhaka')?.nameBn).toBe('ঢাকা');
    });

    it('reports how many districts each division has', () => {
      const result = service.listDivisions();

      expect(result.ok && result.data.find((d) => d.nameEn === 'Sylhet')?.districtCount).toBe(4);
    });
  });

  describe('listDistricts', () => {
    it('returns the districts of a division', () => {
      const result = service.listDistricts('Sylhet');

      expect(
        result.ok && result.data.map((d) => d.nameEn).sort((a, b) => a.localeCompare(b)),
      ).toEqual(['Habiganj', 'Moulvibazar', 'Sunamganj', 'Sylhet']);
    });

    it('echoes the canonical division name however the caller spelled it', () => {
      const result = service.listDistricts('  sYLhet ');

      expect(result.ok && result.data.every((d) => d.divisionEn === 'Sylhet')).toBe(true);
    });

    it('accepts the Bengali name of a division', () => {
      const result = service.listDistricts('ঢাকা');

      expect(result.ok && result.data.length).toBeGreaterThan(0);
    });

    it('answers 404 naming the value it did not recognise', () => {
      expect(service.listDistricts('Narnia')).toEqual({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'Narnia is not a division of Bangladesh.',
      });
    });
  });

  describe('listUnits', () => {
    it('returns the upazilas and city thanas of a district together', () => {
      const result = service.listUnits('Dhaka');
      const names = result.ok ? result.data.map((u) => u.nameEn) : [];

      expect(names).toEqual(expect.arrayContaining(['Savar', 'Gulshan', 'Motijheel', 'Banani']));
    });

    it('reports the kind of each unit', () => {
      const result = service.listUnits('Dhaka');
      const gulshan = result.ok ? result.data.find((u) => u.nameEn === 'Gulshan') : undefined;
      const savar = result.ok ? result.data.find((u) => u.nameEn === 'Savar') : undefined;

      expect(gulshan?.kind).toBe('thana');
      expect(savar?.kind).toBe('upazila');
    });

    it('answers 404 for a district that does not exist', () => {
      expect(service.listUnits('Gotham')).toEqual({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'Gotham is not a district of Bangladesh.',
      });
    });
  });

  describe('listAreas', () => {
    it('returns the areas of a unit with its place in the chain', () => {
      const result = service.listAreas('Dhaka', 'Savar');

      expect(result.ok && result.data.divisionEn).toBe('Dhaka');
      expect(result.ok && result.data.areas.map((a) => a.nameEn)).toContain('Birulia');
    });

    it('exposes post code and coordinates where a source supplied them', () => {
      const result = service.listAreas('Dhaka', 'Gulshan');
      const withPostCode = result.ok ? result.data.areas.filter((a) => a.postCode !== null) : [];

      expect(withPostCode.length).toBeGreaterThan(0);
      expect(withPostCode.every((a) => a.latitude !== null && a.longitude !== null)).toBe(true);
    });

    it('answers 404 for an unknown district', () => {
      expect(service.listAreas('Gotham', 'Savar')).toEqual({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'Gotham is not a district of Bangladesh.',
      });
    });

    it('answers 404 for a unit that is not in that district', () => {
      expect(service.listAreas('Dhaka', 'Nonesuch')).toEqual({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'Nonesuch is not an upazila or thana of Dhaka.',
      });
    });

    it('does not find a unit of another district', () => {
      const result = service.listAreas('Sylhet', 'Savar');

      expect(!result.ok && result.status).toBe(HttpStatus.NOT_FOUND);
    });
  });

  describe('validateChain', () => {
    it('accepts a chain that composes', () => {
      const area = firstAreaOf('Dhaka', 'Savar');

      expect(service.validateChain('Dhaka', 'Dhaka', 'Savar', area)).toEqual({
        ok: true,
        data: undefined,
      });
    });

    it('accepts a chain in any casing or padding', () => {
      expect(service.validateChain(' dhaka ', 'DHAKA', 'savar').ok).toBe(true);
    });

    it('accepts a city thana with no areas beneath it', () => {
      expect(service.validateChain('Dhaka', 'Dhaka', 'Banani').ok).toBe(true);
    });

    it.each([[undefined], [null], ['']])('accepts an omitted area (%p)', (area) => {
      expect(service.validateChain('Dhaka', 'Dhaka', 'Savar', area).ok).toBe(true);
    });

    it('rejects an unknown division with 400', () => {
      expect(service.validateChain('Narnia', 'Dhaka', 'Savar')).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'Narnia is not a division of Bangladesh.',
      });
    });

    it('rejects a district that exists but sits in another division', () => {
      expect(service.validateChain('Sylhet', 'Gazipur', 'Kaliganj')).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'Gazipur is not a district of Sylhet.',
      });
    });

    it('rejects a unit that does not belong to the district', () => {
      expect(service.validateChain('Dhaka', 'Dhaka', 'Sitakunda')).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'Sitakunda is not an upazila or thana of Dhaka.',
      });
    });

    it('rejects an area that does not belong to the unit', () => {
      expect(service.validateChain('Dhaka', 'Dhaka', 'Savar', 'Gulshan')).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'Gulshan is not an area of Savar.',
      });
    });

    it('rejects four individually valid fields that do not compose', () => {
      // The characteristic bug: every value names a real place, the chain does not exist.
      expect(service.validateChain('Sylhet', 'Dhaka', 'Savar').ok).toBe(false);
    });

    it('resolves a repeated unit name within the district it was given', () => {
      // "Kaliganj" names four different upazilas across the country.
      expect(service.validateChain('Dhaka', 'Gazipur', 'Kaliganj').ok).toBe(true);
      expect(service.validateChain('Dhaka', 'Dhaka', 'Kaliganj').ok).toBe(false);
    });

    it('accepts an area given by its Bengali name', () => {
      const result = service.listAreas('Dhaka', 'Savar');
      const bengali = result.ok ? result.data.areas.find((a) => a.nameBn !== null)?.nameBn : null;

      expect(service.validateChain('Dhaka', 'Dhaka', 'Savar', bengali).ok).toBe(true);
    });
  });

  describe('map search', () => {
    it('answers 503 with the disabled message when no provider is configured', async () => {
      const result = await service.searchPlaces(
        Object.assign(new GeoSearchQueryDto(), { q: 'gulshan', limit: 5 }),
      );

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Map search is not available right now.',
      });
    });

    it('answers 503 for reverse geocoding too when disabled', async () => {
      const result = await service.reverseGeocode(
        Object.assign(new GeoReverseQueryDto(), { lat: 23.79, lng: 90.4 }),
      );

      expect(!result.ok && result.message).toBe('Map search is not available right now.');
    });

    it('distinguishes a provider failure from an empty result', async () => {
      const failing = new GeoService(
        {
          name: 'stub',
          isConfigured: true,
          search: () => Promise.resolve(null),
          reverse: () => Promise.resolve(null),
        },
        logger,
        jest.fn(),
      );

      const result = await failing.searchPlaces(
        Object.assign(new GeoSearchQueryDto(), { q: 'gulshan', limit: 5 }),
      );

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Map search is temporarily unavailable. Please try again shortly.',
      });
    });

    it('returns an empty list — a 200 — when the provider genuinely found nothing', async () => {
      const empty = new GeoService(
        {
          name: 'stub',
          isConfigured: true,
          search: () => Promise.resolve([]),
          reverse: () => Promise.resolve(null),
        },
        logger,
        jest.fn(),
      );

      await expect(
        empty.searchPlaces(Object.assign(new GeoSearchQueryDto(), { q: 'nowhere', limit: 5 })),
      ).resolves.toEqual({ ok: true, data: [] });
    });

    it('maps a provider hit onto the wire contract', async () => {
      const stub = new GeoService(
        {
          name: 'stub',
          isConfigured: true,
          search: () =>
            Promise.resolve([{ label: 'Gulshan 1, Dhaka', latitude: 23.79, longitude: 90.41 }]),
          reverse: () => Promise.resolve(null),
        },
        logger,
        jest.fn(),
      );

      const result = await stub.searchPlaces(
        Object.assign(new GeoSearchQueryDto(), { q: 'gulshan', limit: 5 }),
      );

      expect(result.ok && result.data[0]).toEqual({
        label: 'Gulshan 1, Dhaka',
        latitude: 23.79,
        longitude: 90.41,
        postCode: null,
      });
    });
  });

  describe('validateDistrict', () => {
    it('accepts a real division/district pair', () => {
      expect(service.validateDistrict('Dhaka', 'Gazipur')).toEqual({ ok: true, data: undefined });
    });

    it('still rejects a district that sits in another division', () => {
      // An unlisted AREA is allowed; an invented district is not — routing needs this level.
      expect(service.validateDistrict('Sylhet', 'Gazipur')).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'Gazipur is not a district of Sylhet.',
      });
    });

    it('rejects an unknown division', () => {
      expect(service.validateDistrict('Narnia', 'Gazipur').ok).toBe(false);
    });
  });

  describe('resolveMapLink', () => {
    const link = (value: string): GeoResolveLinkDto =>
      Object.assign(new GeoResolveLinkDto(), { link: value });

    it('reads coordinates straight out of a pasted URL', async () => {
      const result = await service.resolveMapLink(
        link('https://www.google.com/maps/@23.7925,90.4078,17z'),
      );

      expect(result.ok && result.data.latitude).toBeCloseTo(23.7925, 3);
      // No provider configured in this suite, so there is no description — but the paste
      // still succeeds, because coordinates are the part that matters.
      expect(result.ok && result.data.label).toBeNull();
    });

    it('accepts a bare coordinate pair', async () => {
      const result = await service.resolveMapLink(link('23.7925, 90.4078'));

      expect(result.ok).toBe(true);
    });

    it('rejects something that is not a location', async () => {
      const result = await service.resolveMapLink(link('my house near the big mosque'));

      expect(!result.ok && result.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('rejects a pin outside Bangladesh', async () => {
      const result = await service.resolveMapLink(
        link('https://www.google.com/maps/@48.8566,2.3522,17z'),
      );

      expect(!result.ok && result.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('follows a Google short link and reads the destination', async () => {
      const follow = jest
        .fn()
        .mockResolvedValue('https://www.google.com/maps/place/X/@23.7925,90.4078,17z');
      const withFollow = new GeoService(new NoopGeocodingGateway(), logger, follow);

      const result = await withFollow.resolveMapLink(link('https://maps.app.goo.gl/abc123'));

      expect(result.ok && result.data.longitude).toBeCloseTo(90.4078, 3);
      expect(follow).toHaveBeenCalledWith('https://maps.app.goo.gl/abc123');
    });

    it('never follows a non-Google URL — SSRF guard', async () => {
      const follow = jest.fn();
      const withFollow = new GeoService(new NoopGeocodingGateway(), logger, follow);

      const result = await withFollow.resolveMapLink(
        link('http://169.254.169.254/latest/meta-data/'),
      );

      expect(!result.ok && result.status).toBe(HttpStatus.BAD_REQUEST);
      expect(follow).not.toHaveBeenCalled();
    });

    it('fails the paste gracefully when the short link cannot be followed', async () => {
      const follow = jest.fn().mockRejectedValue(new Error('timeout'));
      const withFollow = new GeoService(new NoopGeocodingGateway(), logger, follow);

      const result = await withFollow.resolveMapLink(link('https://maps.app.goo.gl/abc123'));

      expect(!result.ok && result.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('adds a description when a geocoder is configured, but does not require one', async () => {
      const described = new GeoService(
        {
          name: 'stub',
          isConfigured: true,
          search: () => Promise.resolve([]),
          reverse: () =>
            Promise.resolve({
              label: 'গুলশান ১, ঢাকা',
              latitude: 23.79,
              longitude: 90.41,
              postCode: '1212',
            }),
        },
        logger,
        jest.fn(),
      );

      const result = await described.resolveMapLink(link('23.7925, 90.4078'));

      expect(result.ok && result.data.label).toBe('গুলশান ১, ঢাকা');
      expect(result.ok && result.data.postCode).toBe('1212');
    });
  });
});
