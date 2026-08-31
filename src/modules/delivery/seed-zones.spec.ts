import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../test/support/mocks';
import { GeoService } from '../geo/geo.service';

/**
 * Locks the seeded delivery rules to the geography dataset.
 *
 * A rule naming a district that does not exist matches no address and silently bills everyone
 * there the default rate — the failure is invisible in production and obvious here. This test
 * reads the committed seed migration, so a rename on either side breaks the build rather than
 * the pricing.
 *
 * The path must stay inside prisma/migrations: prisma/sql/local is gitignored, so a fixture read
 * from there exists only on the author's machine and every CI checkout fails with ENOENT.
 */
describe('seeded delivery zone rules', () => {
  const sqlPath = join(
    __dirname,
    '../../../prisma/migrations/20260831210000_seed_delivery_zones/migration.sql',
  );
  let geo: GeoService;
  let logger: jest.Mocked<PinoLogger>;

  beforeAll(() => {
    logger = createMockLogger();
    // validateDistrict is pure lookup against the vendored dataset; the geocoder and URL
    // resolver are never reached, so stubs are enough and no network is possible.
    geo = new GeoService(
      { search: jest.fn(), reverse: jest.fn() } as never,
      logger,
      jest.fn() as never,
    );
  });

  /** Pulls ('id', 'zone', 'Division', 'District', unit) tuples out of the rules INSERT. */
  const seededRules = (): { division: string; district: string | null }[] => {
    const sql = readFileSync(sqlPath, 'utf8');
    const insert = sql.slice(sql.indexOf('INSERT INTO public.delivery_zone_rules'));
    const body = insert.slice(0, insert.indexOf('ON CONFLICT'));

    return [
      ...body.matchAll(/\('[^']+',\s*'[^']+',\s*'([^']+)',\s*'([^']+)',\s*(NULL|'[^']+')\)/g),
    ].map((match) => ({ division: match[1], district: match[2] }));
  };

  it('finds the seeded rules in the SQL', () => {
    expect(seededRules().length).toBeGreaterThan(0);
  });

  it('names only districts that exist in their stated division', () => {
    for (const { division, district } of seededRules()) {
      const result = geo.validateDistrict(division, district as string);

      expect({ division, district, ok: result.ok }).toEqual({ division, district, ok: true });
    }
  });

  it('covers every launch district the business targets', () => {
    const districts = seededRules().map((rule) => rule.district);

    expect(districts).toEqual(
      expect.arrayContaining(['Dhaka', 'Narayanganj', 'Gazipur', 'Manikganj', 'Chattogram']),
    );
  });

  it('seeds exactly one default zone, since two would make the fee row-order dependent', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    const zoneRows = sql.slice(
      sql.indexOf('INSERT INTO public.delivery_zones'),
      sql.indexOf('INSERT INTO public.delivery_zone_rules'),
    );

    expect([...zoneRows.matchAll(/,\s*true,\s*\d+,\s*now\(\)\)/g)]).toHaveLength(1);
  });
});
