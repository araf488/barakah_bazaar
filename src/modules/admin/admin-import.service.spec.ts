import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AuthService } from '../auth/auth.service';
import { AdminCatalogRepository } from './admin-catalog.repository';
import { AdminImportService } from './admin-import.service';
import { ImportProductsDto } from './dto/import.dto';

const actor: AuthenticatedUser = {
  supabaseUserId: '11111111-1111-1111-1111-111111111111',
  email: 'buyer@barakahbazaar.com.bd',
  role: UserRole.MARKETING,
};

const HEADER =
  'slug,nameEn,nameBn,categorySlug,sku,variantNameEn,variantNameBn,pricePoysha,unitLabel';
const ROW = 'almonds,Almonds,কাঠবাদাম,dry-fruits,ALM-500,500g,৫০০ গ্রাম,125000,500g';

const upload = (csv: string, dryRun = false): ImportProductsDto =>
  Object.assign(new ImportProductsDto(), { csv, dryRun });

describe('AdminImportService', () => {
  let repository: Record<string, jest.Mock>;
  let authService: { resolveActiveUserId: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: AdminImportService;

  beforeEach(() => {
    repository = {
      findCategoryBySlug: jest.fn().mockResolvedValue({ id: 'cat-1', isActive: true }),
      findProductBySlug: jest.fn().mockResolvedValue(undefined),
      findVariantBySku: jest.fn().mockResolvedValue(undefined),
      importProducts: jest.fn().mockResolvedValue({ products: 1, variants: 1 }),
    };
    authService = {
      resolveActiveUserId: jest.fn().mockResolvedValue({ ok: true, data: 'user-1' }),
    };
    logger = createMockLogger();
    service = new AdminImportService(
      repository as unknown as AdminCatalogRepository,
      authService as unknown as AuthService,
      logger,
    );
  });

  const run = async (csv: string, dryRun = false) => {
    const result = await service.importProducts(actor, upload(csv, dryRun));
    if (!result.ok) {
      throw new Error(`expected success, got ${result.status}: ${result.message}`);
    }
    return result.data;
  };

  describe('happy path', () => {
    it('imports one product with one variant', async () => {
      const report = await run(`${HEADER}\n${ROW}`);

      expect(report).toEqual(
        expect.objectContaining({
          applied: true,
          dryRun: false,
          totalRows: 1,
          productsCreated: 1,
          variantsCreated: 1,
          issues: [],
        }),
      );
    });

    it('groups rows that share a slug into one product with several variants', async () => {
      // The shape a grocery catalog actually arrives in: 250g / 500g / 1kg of one item.
      repository.importProducts.mockResolvedValue({ products: 1, variants: 2 });
      const csv = [
        HEADER,
        ROW,
        'almonds,Almonds,কাঠবাদাম,dry-fruits,ALM-1000,1kg,১ কেজি,240000,1kg',
      ].join('\n');

      await run(csv);

      const plan = repository.importProducts.mock.calls[0][0] as { variants: unknown[] }[];
      expect(plan).toHaveLength(1);
      expect(plan[0].variants).toHaveLength(2);
    });

    it('converts poysha to BigInt for the price columns', async () => {
      await run(`${HEADER}\n${ROW}`);

      const plan = repository.importProducts.mock.calls[0][0] as {
        variants: { pricePoysha: bigint }[];
      }[];
      expect(plan[0].variants[0].pricePoysha).toBe(125000n);
    });

    it('resolves each category once, however many products use it', async () => {
      const csv = [
        HEADER,
        ROW,
        'cashews,Cashews,কাজু,dry-fruits,CSH-500,500g,৫০০ গ্রাম,180000,500g',
      ].join('\n');

      await run(csv);

      expect(repository.findCategoryBySlug).toHaveBeenCalledTimes(1);
    });
  });

  describe('dry run', () => {
    it('reports what would happen and writes nothing', async () => {
      const report = await run(`${HEADER}\n${ROW}`, true);

      expect(report).toEqual(
        expect.objectContaining({ dryRun: true, applied: false, productsCreated: 1 }),
      );
      expect(repository.importProducts).not.toHaveBeenCalled();
    });
  });

  describe('validation — nothing is written unless every row is valid', () => {
    it('rejects the whole file when one row is bad', async () => {
      const csv = [HEADER, ROW, 'cashews,,কাজু,dry-fruits,CSH,500g,৫০০,1000,500g'].join('\n');

      const report = await run(csv);

      expect(report.applied).toBe(false);
      expect(report.productsCreated).toBe(0);
      expect(repository.importProducts).not.toHaveBeenCalled();
    });

    it('names the line and the column an operator sees in their spreadsheet', async () => {
      const csv = [HEADER, 'almonds,Almonds,কাঠবাদাম,dry-fruits,ALM,500g,৫০০,0,500g'].join('\n');

      const report = await run(csv);

      expect(report.issues[0]).toEqual({
        line: 2,
        column: 'pricePoysha',
        message: 'pricePoysha must be a whole number above zero.',
      });
    });

    it('reports every problem at once rather than one per upload', async () => {
      const csv = [HEADER, ',,,dry-fruits,,,,0,'].join('\n');

      const report = await run(csv);

      expect(report.issues.length).toBeGreaterThan(4);
    });

    it('rejects a fractional price', async () => {
      const csv = [HEADER, 'almonds,Almonds,কাঠবাদাম,dry-fruits,ALM,500g,৫০০,1250.5,500g'].join(
        '\n',
      );

      const report = await run(csv);

      expect(report.issues.some((issue) => issue.column === 'pricePoysha')).toBe(true);
    });

    it('rejects a malformed slug, because the storefront routes on it', async () => {
      const csv = [HEADER, 'Dry Fruits,Almonds,কাঠবাদাম,dry-fruits,ALM,500g,৫০০,1000,500g'].join(
        '\n',
      );

      const report = await run(csv);

      expect(report.issues.some((issue) => issue.column === 'slug')).toBe(true);
    });

    it('rejects a duplicate SKU inside the file, naming the earlier line', async () => {
      const csv = [HEADER, ROW, ROW.replace('almonds', 'cashews')].join('\n');

      const report = await run(csv);

      expect(report.issues[0].message).toContain('already used on line 2');
    });

    it('rejects a SKU that already exists in the catalog', async () => {
      repository.findVariantBySku.mockResolvedValue({ id: 'var-1' });

      const report = await run(`${HEADER}\n${ROW}`);

      expect(report.issues[0].message).toContain('already exists in the catalog');
    });

    it('refuses to touch a product that already exists — imports create, they do not edit', async () => {
      repository.findProductBySlug.mockResolvedValue({ id: 'prod-1' });

      const report = await run(`${HEADER}\n${ROW}`);

      expect(report.issues[0].message).toContain('edit the existing one instead');
      expect(repository.importProducts).not.toHaveBeenCalled();
    });

    it('rejects an unknown category', async () => {
      repository.findCategoryBySlug.mockResolvedValue(undefined);

      const report = await run(`${HEADER}\n${ROW}`);

      expect(report.issues[0].column).toBe('categorySlug');
    });

    it('rejects an inactive category', async () => {
      repository.findCategoryBySlug.mockResolvedValue({ id: 'cat-1', isActive: false });

      const report = await run(`${HEADER}\n${ROW}`);

      expect(report.issues[0].message).toContain('No active category');
    });

    it('rejects rows that share a slug but disagree about the product', async () => {
      // Otherwise which row wins would depend on file order.
      const csv = [
        HEADER,
        ROW,
        'almonds,Cashews,কাজু,dry-fruits,ALM-1000,1kg,১ কেজি,240000,1kg',
      ].join('\n');

      const report = await run(csv);

      expect(report.issues[0].message).toContain('disagrees with line 2');
    });

    it('requires a weight when the product is priced by weight', async () => {
      const csv = [`${HEADER},pricingMode`, `${ROW},WEIGHT`].join('\n');

      const report = await run(csv);

      expect(report.issues[0].column).toBe('weightGrams');
    });

    it('accepts a weight-priced product that supplies the weight', async () => {
      const csv = [`${HEADER},pricingMode,weightGrams`, `${ROW},WEIGHT,500`].join('\n');

      const report = await run(csv);

      expect(report.issues).toEqual([]);
      expect(report.applied).toBe(true);
    });

    it('rejects a compare-at price below the selling price', async () => {
      const csv = [`${HEADER},compareAtPricePoysha`, `${ROW},100000`].join('\n');

      const report = await run(csv);

      expect(report.issues[0].column).toBe('compareAtPricePoysha');
    });

    it('rejects an unrecognised enum value, listing the allowed ones', async () => {
      const csv = [`${HEADER},storageType`, `${ROW},FREEZING`].join('\n');

      const report = await run(csv);

      expect(report.issues[0].message).toContain('AMBIENT');
    });
  });

  describe('file-level failures', () => {
    it('refuses an empty file', async () => {
      const result = await service.importProducts(actor, upload(HEADER));

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'The file contains no product rows.',
      });
    });

    it('refuses a file above the row cap, so the transaction stays bounded', async () => {
      const rows = Array.from({ length: 501 }, (_unused, index) =>
        ROW.replace('almonds', `item-${index}`).replace('ALM-500', `SKU-${index}`),
      );

      const result = await service.importProducts(actor, upload([HEADER, ...rows].join('\n')));

      expect(!result.ok && result.message).toBe(
        'An import may contain at most 500 rows. Split the file and upload it in parts.',
      );
    });

    it('answers 503 when the write transaction failed', async () => {
      repository.importProducts.mockResolvedValue(null);

      const result = await service.importProducts(actor, upload(`${HEADER}\n${ROW}`));

      expect(!result.ok && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it('passes a disabled staff account through without reading the file', async () => {
      authService.resolveActiveUserId.mockResolvedValue({
        ok: false,
        status: HttpStatus.FORBIDDEN,
        message: 'This account has been disabled. Please contact support.',
      });

      const result = await service.importProducts(actor, upload(`${HEADER}\n${ROW}`));

      expect(!result.ok && result.status).toBe(HttpStatus.FORBIDDEN);
      expect(repository.findCategoryBySlug).not.toHaveBeenCalled();
    });
  });

  describe('audit', () => {
    it('records one entry per imported product, with prices serialised', async () => {
      await run(`${HEADER}\n${ROW}`);

      const build = repository.importProducts.mock.calls[0][1] as (
        product: unknown,
        variants: unknown,
      ) => Record<string, unknown>;
      const audit = build({ id: 'prod-1' }, [{ id: 'var-1', pricePoysha: 125000n }]);

      expect(audit.action).toBe('product.imported');
      expect(audit.actorId).toBe('user-1');
      expect(JSON.stringify(audit.after)).toContain('125000');
    });
  });
});
