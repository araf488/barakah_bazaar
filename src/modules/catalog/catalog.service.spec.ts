import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { categoryFixture, productFixture } from '../../../test/support/catalog-fixtures';
import { createMockLogger } from '../../../test/support/mocks';
import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';
import { ProductQueryDto } from './dto/product-query.dto';

const buildQuery = (overrides: Partial<ProductQueryDto> = {}): ProductQueryDto =>
  Object.assign(new ProductQueryDto(), overrides);

describe('CatalogService', () => {
  let repository: {
    findActiveCategories: jest.Mock;
    findPublishedProducts: jest.Mock;
    findPublishedProductBySlug: jest.Mock;
    searchProductIds: jest.Mock;
    findPublishedByIds: jest.Mock;
  };
  let logger: jest.Mocked<PinoLogger>;
  let service: CatalogService;

  beforeEach(() => {
    repository = {
      findActiveCategories: jest.fn(),
      findPublishedProducts: jest.fn(),
      findPublishedProductBySlug: jest.fn(),
      searchProductIds: jest.fn().mockResolvedValue([]),
      findPublishedByIds: jest.fn().mockResolvedValue([]),
    };
    logger = createMockLogger();
    service = new CatalogService(repository as unknown as CatalogRepository, logger);
  });

  describe('getCategoryTree', () => {
    it('returns the assembled tree', async () => {
      repository.findActiveCategories.mockResolvedValue([
        categoryFixture({ id: 'beauty', slug: 'health-beauty' }),
        categoryFixture({ id: 'baby', slug: 'baby', parentId: 'beauty' }),
      ]);

      const result = await service.getCategoryTree();

      expect(result.ok).toBe(true);
      expect(result.ok && result.data[0].children[0].slug).toBe('baby');
    });

    it('returns an empty tree rather than an error when there are no categories', async () => {
      repository.findActiveCategories.mockResolvedValue([]);

      const result = await service.getCategoryTree();

      expect(result).toEqual({ ok: true, data: [] });
    });

    it('answers 503 when the repository could not read', async () => {
      repository.findActiveCategories.mockResolvedValue(null);

      const result = await service.getCategoryTree();

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });
    });

    it('answers 500 and logs when the repository throws', async () => {
      const failure = new Error('unexpected');
      repository.findActiveCategories.mockRejectedValue(failure);

      const result = await service.getCategoryTree();

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Something went wrong on our end. Please try again.',
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: failure }),
        'Exception occurred in CatalogService.getCategoryTree',
      );
    });
  });

  describe('listProducts', () => {
    it('returns the mapped page', async () => {
      repository.findPublishedProducts.mockResolvedValue({ items: [productFixture()], total: 1 });

      const result = await service.listProducts(buildQuery());

      expect(result.ok).toBe(true);
      expect(result.ok && result.data.items[0].slug).toBe('premium-almonds');
    });

    it('reports pagination metadata derived from the total', async () => {
      repository.findPublishedProducts.mockResolvedValue({ items: [productFixture()], total: 45 });

      const result = await service.listProducts(buildQuery({ page: 2, limit: 20 }));

      expect(result.ok && result.data.meta).toEqual({
        page: 2,
        limit: 20,
        totalItems: 45,
        totalPages: 3,
        hasNextPage: true,
      });
    });

    it('reports no next page on the last page', async () => {
      repository.findPublishedProducts.mockResolvedValue({ items: [], total: 40 });

      const result = await service.listProducts(buildQuery({ page: 2, limit: 20 }));

      expect(result.ok && result.data.meta.hasNextPage).toBe(false);
    });

    it('returns an empty page rather than a 404 when nothing matches', async () => {
      repository.searchProductIds.mockResolvedValue([]);

      const result = await service.listProducts(buildQuery({ search: 'nothing-matches' }));

      expect(result.ok).toBe(true);
      expect(result.ok && result.data.items).toEqual([]);
    });

    it('passes the query through to the repository unchanged', async () => {
      repository.findPublishedProducts.mockResolvedValue({ items: [], total: 0 });
      const query = buildQuery({ categorySlug: 'doi', perishableOnly: true });

      await service.listProducts(query);

      expect(repository.findPublishedProducts).toHaveBeenCalledWith(query);
    });

    it('answers 503 when the repository could not read', async () => {
      repository.findPublishedProducts.mockResolvedValue(null);

      const result = await service.listProducts(buildQuery());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });
    });

    it('answers 500 when the repository throws', async () => {
      repository.findPublishedProducts.mockRejectedValue(new Error('unexpected'));

      const result = await service.listProducts(buildQuery());

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    });
  });

  describe('ranked search', () => {
    const ranked = (ids: string[]) => ids.map((id) => productFixture({ id, slug: `slug-${id}` }));

    it('uses the ranked path once the term is long enough', async () => {
      await service.listProducts(buildQuery({ search: 'almond' }));

      expect(repository.searchProductIds).toHaveBeenCalledWith('almond');
      expect(repository.findPublishedProducts).not.toHaveBeenCalled();
    });

    it('ignores a term below the minimum length', async () => {
      repository.findPublishedProducts.mockResolvedValue({ items: [], total: 0 });

      await service.listProducts(buildQuery({ search: 'a' }));

      expect(repository.searchProductIds).not.toHaveBeenCalled();
      expect(repository.findPublishedProducts).toHaveBeenCalled();
    });

    it('trims the term before searching', async () => {
      await service.listProducts(buildQuery({ search: '  almond  ' }));

      expect(repository.searchProductIds).toHaveBeenCalledWith('almond');
    });

    it('preserves the rank order the database computed', async () => {
      // WHERE id IN (...) returns rows in whatever order Postgres finds convenient, so
      // hydrating without restoring the rank silently discards the ranking.
      repository.searchProductIds.mockResolvedValue(['p3', 'p1', 'p2']);
      repository.findPublishedByIds.mockResolvedValue(ranked(['p1', 'p2', 'p3']));

      const result = await service.listProducts(buildQuery({ search: 'almond' }));

      expect(result.ok && result.data.items.map((item) => item.id)).toEqual(['p3', 'p1', 'p2']);
    });

    it('pages the ranked ids rather than the hydrated rows', async () => {
      repository.searchProductIds.mockResolvedValue(['p1', 'p2', 'p3', 'p4', 'p5']);
      repository.findPublishedByIds.mockResolvedValue(ranked(['p3', 'p4']));

      await service.listProducts(buildQuery({ search: 'almond', page: 2, limit: 2 }));

      expect(repository.findPublishedByIds).toHaveBeenCalledWith(['p3', 'p4']);
    });

    it('reports the total as the full match count, not the page size', async () => {
      repository.searchProductIds.mockResolvedValue(['p1', 'p2', 'p3', 'p4', 'p5']);
      repository.findPublishedByIds.mockResolvedValue(ranked(['p1', 'p2']));

      const result = await service.listProducts(buildQuery({ search: 'almond', limit: 2 }));

      expect(result.ok && result.data.meta.totalItems).toBe(5);
      expect(result.ok && result.data.meta.hasNextPage).toBe(true);
    });

    it('drops an id that no longer hydrates rather than emitting a hole', async () => {
      // A product unpublished between the ranking query and the fetch.
      repository.searchProductIds.mockResolvedValue(['p1', 'gone', 'p2']);
      repository.findPublishedByIds.mockResolvedValue(ranked(['p1', 'p2']));

      const result = await service.listProducts(buildQuery({ search: 'almond' }));

      expect(result.ok && result.data.items.map((item) => item.id)).toEqual(['p1', 'p2']);
    });

    it('reports 503 when the ranking query fails', async () => {
      repository.searchProductIds.mockResolvedValue(null);

      const result = await service.listProducts(buildQuery({ search: 'almond' }));

      expect(result.ok).toBe(false);
    });

    it('reports 503 when hydration fails', async () => {
      repository.searchProductIds.mockResolvedValue(['p1']);
      repository.findPublishedByIds.mockResolvedValue(null);

      const result = await service.listProducts(buildQuery({ search: 'almond' }));

      expect(result.ok).toBe(false);
    });

    it('asks for nothing when the page is past the last result', async () => {
      repository.searchProductIds.mockResolvedValue(['p1', 'p2']);

      await service.listProducts(buildQuery({ search: 'almond', page: 9, limit: 20 }));

      expect(repository.findPublishedByIds).toHaveBeenCalledWith([]);
    });
  });

  describe('getProductBySlug', () => {
    it('returns the product detail', async () => {
      repository.findPublishedProductBySlug.mockResolvedValue(productFixture());

      const result = await service.getProductBySlug('premium-almonds');

      expect(result.ok && result.data.categorySlug).toBe('dry-fruits');
    });

    it('answers 404 with the resource name when nothing matches', async () => {
      repository.findPublishedProductBySlug.mockResolvedValue(null);

      const result = await service.getProductBySlug('missing');

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'Product was not found.',
      });
    });

    it('answers 500 and logs the slug when the repository throws', async () => {
      const failure = new Error('unexpected');
      repository.findPublishedProductBySlug.mockRejectedValue(failure);

      const result = await service.getProductBySlug('premium-almonds');

      expect(!result.ok && result.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: failure, slug: 'premium-almonds' }),
        'Exception occurred in CatalogService.getProductBySlug',
      );
    });
  });
});
