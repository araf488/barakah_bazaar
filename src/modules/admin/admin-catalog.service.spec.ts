import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PricingMode, UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AuthService } from '../auth/auth.service';
import { AdminCatalogRepository } from './admin-catalog.repository';
import { AdminCatalogService } from './admin-catalog.service';
import { CreateCategoryDto, CreateProductDto, CreateVariantDto } from './dto/admin-catalog.dto';

const actor: AuthenticatedUser = {
  supabaseUserId: '11111111-1111-1111-1111-111111111111',
  email: 'marketing@barakahbazaar.com.bd',
  role: UserRole.MARKETING,
};

const category = (overrides = {}) => ({
  id: 'cat-1',
  slug: 'dry-fruits',
  nameEn: 'Dry Fruits',
  nameBn: 'শুকনো ফল',
  parentId: null,
  imageUrl: null,
  sortOrder: 0,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const product = (overrides = {}) => ({
  id: 'prod-1',
  slug: 'premium-almonds',
  categoryId: 'cat-1',
  pricingMode: PricingMode.UNIT,
  isActive: true,
  publishedAt: null,
  ...overrides,
});

const variant = (overrides = {}) => ({
  id: 'var-1',
  productId: 'prod-1',
  sku: 'ALM-500',
  pricePoysha: 125000n,
  weightGrams: null,
  isDefault: true,
  isActive: true,
  ...overrides,
});

const categoryDto = (overrides: Partial<CreateCategoryDto> = {}): CreateCategoryDto =>
  Object.assign(new CreateCategoryDto(), {
    slug: 'dry-fruits',
    nameEn: 'Dry Fruits',
    nameBn: 'শুকনো ফল',
    ...overrides,
  });

const productDto = (overrides: Partial<CreateProductDto> = {}): CreateProductDto =>
  Object.assign(new CreateProductDto(), {
    slug: 'premium-almonds',
    nameEn: 'Premium Almonds',
    nameBn: 'প্রিমিয়াম কাঠবাদাম',
    categoryId: 'cat-1',
    ...overrides,
  });

const variantDto = (overrides: Partial<CreateVariantDto> = {}): CreateVariantDto =>
  Object.assign(new CreateVariantDto(), {
    sku: 'ALM-500',
    nameEn: '500g',
    nameBn: '৫০০ গ্রাম',
    pricePoysha: 125000,
    unitLabel: '500g',
    ...overrides,
  });

describe('AdminCatalogService', () => {
  let repository: Record<string, jest.Mock>;
  let authService: { resolveActiveUserId: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: AdminCatalogService;

  beforeEach(() => {
    repository = {
      findCategoryById: jest.fn().mockResolvedValue(category()),
      findCategoryBySlug: jest.fn().mockResolvedValue(undefined),
      createCategory: jest.fn().mockResolvedValue(category()),
      updateCategory: jest.fn().mockResolvedValue(category()),
      countCategoryDependents: jest.fn().mockResolvedValue(0),
      findAncestorIds: jest.fn().mockResolvedValue([]),
      findProductById: jest.fn().mockResolvedValue(product()),
      findProductBySlug: jest.fn().mockResolvedValue(undefined),
      createProduct: jest.fn().mockResolvedValue(product()),
      updateProduct: jest.fn().mockResolvedValue(product()),
      countActiveVariants: jest.fn().mockResolvedValue(1),
      findVariantById: jest.fn().mockResolvedValue(variant()),
      findVariantBySku: jest.fn().mockResolvedValue(undefined),
      createVariant: jest.fn().mockResolvedValue(variant()),
      updateVariant: jest.fn().mockResolvedValue(variant()),
    };
    authService = {
      resolveActiveUserId: jest.fn().mockResolvedValue({ ok: true, data: 'user-1' }),
    };
    logger = createMockLogger();
    service = new AdminCatalogService(
      repository as unknown as AdminCatalogRepository,
      authService as unknown as AuthService,
      logger,
    );
  });

  /** Every write hands the repository an audit payload; this reads it back. */
  const auditOf = (mock: jest.Mock, resultIndex = 0): Record<string, unknown> => {
    const calls = mock.mock.calls as unknown[][];
    const build = calls[0][calls[0].length - 1] as (row: unknown) => Record<string, unknown>;
    return build(calls[0][resultIndex]);
  };

  describe('createCategory', () => {
    it('creates and returns the category', async () => {
      const result = await service.createCategory(actor, categoryDto());

      expect(result.ok && result.data.slug).toBe('dry-fruits');
    });

    it('records who acted, from the verified token', async () => {
      await service.createCategory(actor, categoryDto());

      const audit = auditOf(repository.createCategory);
      expect(audit.actorId).toBe('user-1');
      expect(audit.actorRole).toBe(UserRole.MARKETING);
      expect(audit.action).toBe('category.created');
    });

    it('refuses a slug already in use', async () => {
      repository.findCategoryBySlug.mockResolvedValue(category());

      const result = await service.createCategory(actor, categoryDto());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'The slug "dry-fruits" is already in use. Slugs must be unique.',
      });
      expect(repository.createCategory).not.toHaveBeenCalled();
    });

    it('refuses an inactive parent', async () => {
      repository.findCategoryById.mockResolvedValue(category({ isActive: false }));

      const result = await service.createCategory(actor, categoryDto({ parentId: 'cat-9' }));

      expect(!result.ok && result.message).toBe(
        'The parent category does not exist or is inactive.',
      );
    });

    it('answers 503 with the audit message when the write transaction failed', async () => {
      // A null from the repository means the write AND its audit row rolled back together.
      repository.createCategory.mockResolvedValue(null);

      const result = await service.createCategory(actor, categoryDto());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message:
          'The change could not be recorded in the audit trail and was not applied. Please try again.',
      });
    });

    it('passes a disabled staff account 403 through without writing', async () => {
      authService.resolveActiveUserId.mockResolvedValue({
        ok: false,
        status: HttpStatus.FORBIDDEN,
        message: 'This account has been disabled. Please contact support.',
      });

      const result = await service.createCategory(actor, categoryDto());

      expect(!result.ok && result.status).toBe(HttpStatus.FORBIDDEN);
      expect(repository.createCategory).not.toHaveBeenCalled();
    });
  });

  describe('updateCategory', () => {
    it('refuses moving a category beneath itself', async () => {
      const result = await service.updateCategory(actor, 'cat-1', { parentId: 'cat-1' });

      expect(!result.ok && result.message).toBe(
        'A category cannot be moved beneath itself or one of its own descendants.',
      );
    });

    it('refuses moving a category beneath its own descendant', async () => {
      // A cycle makes the storefront's category walk loop forever.
      repository.findAncestorIds.mockResolvedValue(['cat-2', 'cat-1']);

      const result = await service.updateCategory(actor, 'cat-1', { parentId: 'cat-3' });

      expect(!result.ok && result.status).toBe(HttpStatus.BAD_REQUEST);
      expect(repository.updateCategory).not.toHaveBeenCalled();
    });

    it('allows a legitimate move', async () => {
      repository.findAncestorIds.mockResolvedValue(['cat-9']);

      const result = await service.updateCategory(actor, 'cat-1', { parentId: 'cat-2' });

      expect(result.ok).toBe(true);
    });

    it('records the before and after states', async () => {
      await service.updateCategory(actor, 'cat-1', { nameEn: 'Nuts' });

      const audit = auditOf(repository.updateCategory);
      expect(audit.before).toBeDefined();
      expect(audit.after).toBeDefined();
      expect(audit.action).toBe('category.updated');
    });

    it('answers 404 for a category that does not exist', async () => {
      repository.findCategoryById.mockResolvedValue(undefined);

      const result = await service.updateCategory(actor, 'cat-9', {});

      expect(!result.ok && result.status).toBe(HttpStatus.NOT_FOUND);
    });
  });

  describe('deactivateCategory', () => {
    it('refuses while live products still hang off it', async () => {
      // Otherwise those products become reachable by link but invisible in navigation.
      repository.countCategoryDependents.mockResolvedValue(3);

      const result = await service.deactivateCategory(actor, 'cat-1');

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message:
          'This category still has active products or subcategories. Move or deactivate them first.',
      });
    });

    it('deactivates rather than deletes, because orders reference the row', async () => {
      await service.deactivateCategory(actor, 'cat-1');

      expect(repository.updateCategory.mock.calls[0][1]).toEqual({ isActive: false });
    });
  });

  describe('createProduct', () => {
    it('creates an unpublished product', async () => {
      const result = await service.createProduct(actor, productDto());

      expect(result.ok).toBe(true);
      expect(repository.createProduct.mock.calls[0][0].publishedAt).toBeUndefined();
    });

    it('refuses an inactive category', async () => {
      repository.findCategoryById.mockResolvedValue(category({ isActive: false }));

      const result = await service.createProduct(actor, productDto());

      expect(!result.ok && result.message).toBe(
        'The selected category does not exist or is inactive.',
      );
    });

    it('refuses a duplicate slug', async () => {
      repository.findProductBySlug.mockResolvedValue(product());

      const result = await service.createProduct(actor, productDto());

      expect(!result.ok && result.status).toBe(HttpStatus.CONFLICT);
    });
  });

  describe('publishProduct', () => {
    it('publishes when there is something to sell', async () => {
      const result = await service.publishProduct(actor, 'prod-1');

      expect(result.ok).toBe(true);
      expect(repository.updateProduct.mock.calls[0][1].publishedAt).toBeInstanceOf(Date);
    });

    it('refuses a product with no active variant', async () => {
      // The public catalog computes a "from" price across active variants; publishing
      // without one puts an item on the storefront at zero that nobody can buy.
      repository.countActiveVariants.mockResolvedValue(0);

      const result = await service.publishProduct(actor, 'prod-1');

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message:
          'A product needs at least one active variant with a price before it can be published.',
      });
      expect(repository.updateProduct).not.toHaveBeenCalled();
    });

    it('records the publish as its own action', async () => {
      await service.publishProduct(actor, 'prod-1');

      expect(auditOf(repository.updateProduct).action).toBe('product.published');
    });
  });

  describe('unpublishProduct', () => {
    it('clears publishedAt without deleting the row', async () => {
      await service.unpublishProduct(actor, 'prod-1');

      expect(repository.updateProduct.mock.calls[0][1]).toEqual({ publishedAt: null });
      expect(auditOf(repository.updateProduct).action).toBe('product.unpublished');
    });
  });

  describe('createVariant', () => {
    it('creates the variant and converts poysha to BigInt', async () => {
      await service.createVariant(actor, 'prod-1', variantDto());

      expect(repository.createVariant.mock.calls[0][1].pricePoysha).toBe(125000n);
    });

    it('refuses a duplicate SKU', async () => {
      repository.findVariantBySku.mockResolvedValue(variant());

      const result = await service.createVariant(actor, 'prod-1', variantDto());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'The SKU "ALM-500" is already in use.',
      });
    });

    it('requires a weight when the product is priced by weight', async () => {
      // Money.forWeight has nothing to multiply without one.
      repository.findProductById.mockResolvedValue(product({ pricingMode: PricingMode.WEIGHT }));

      const result = await service.createVariant(actor, 'prod-1', variantDto());

      expect(!result.ok && result.message).toBe(
        'This product is priced by weight, so every variant must specify its weight in grams.',
      );
    });

    it('accepts a weight-priced variant that has a weight', async () => {
      repository.findProductById.mockResolvedValue(product({ pricingMode: PricingMode.WEIGHT }));

      const result = await service.createVariant(actor, 'prod-1', variantDto({ weightGrams: 500 }));

      expect(result.ok).toBe(true);
    });

    it('refuses a compare-at price below the selling price', async () => {
      // It would render as a price increase dressed up as a discount.
      const result = await service.createVariant(
        actor,
        'prod-1',
        variantDto({ pricePoysha: 125000, compareAtPricePoysha: 100000 }),
      );

      expect(!result.ok && result.message).toBe(
        'The compare-at price must be higher than the selling price.',
      );
    });

    it('accepts a genuine discount', async () => {
      const result = await service.createVariant(
        actor,
        'prod-1',
        variantDto({ pricePoysha: 100000, compareAtPricePoysha: 125000 }),
      );

      expect(result.ok).toBe(true);
    });

    it('answers 404 when the product does not exist', async () => {
      repository.findProductById.mockResolvedValue(undefined);

      const result = await service.createVariant(actor, 'prod-9', variantDto());

      expect(!result.ok && result.status).toBe(HttpStatus.NOT_FOUND);
    });
  });

  describe('updateVariant', () => {
    it('audits a price change with both the old and new price', async () => {
      await service.updateVariant(actor, 'var-1', { pricePoysha: 99000 });

      const audit = auditOf(repository.updateVariant);
      expect(audit.action).toBe('variant.updated');
      // BigInt is serialised for the JSON column.
      expect(audit.before).toEqual(expect.objectContaining({ pricePoysha: 125000 }));
    });

    it('keeps the stored weight when validating a weight-priced variant', async () => {
      repository.findProductById.mockResolvedValue(product({ pricingMode: PricingMode.WEIGHT }));
      repository.findVariantById.mockResolvedValue(variant({ weightGrams: 500 }));

      const result = await service.updateVariant(actor, 'var-1', { pricePoysha: 99000 });

      expect(result.ok).toBe(true);
    });

    it('answers 404 for a variant that does not exist', async () => {
      repository.findVariantById.mockResolvedValue(undefined);

      const result = await service.updateVariant(actor, 'var-9', {});

      expect(!result.ok && result.status).toBe(HttpStatus.NOT_FOUND);
    });
  });
});
