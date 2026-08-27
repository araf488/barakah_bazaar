import { PinoLogger } from 'nestjs-pino';
import { categoryFixture, productFixture } from '../../../test/support/catalog-fixtures';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createMockLogger } from '../../../test/support/mocks';
import { ProductSortOption } from './catalog.constants';
import { CatalogRepository } from './catalog.repository';
import { ProductQueryDto } from './dto/product-query.dto';

const buildQuery = (overrides: Partial<ProductQueryDto> = {}): ProductQueryDto =>
  Object.assign(new ProductQueryDto(), overrides);

describe('CatalogRepository', () => {
  let prisma: {
    category: { findMany: jest.Mock };
    product: { findMany: jest.Mock; count: jest.Mock; findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let logger: jest.Mocked<PinoLogger>;
  let repository: CatalogRepository;

  beforeEach(() => {
    prisma = {
      category: { findMany: jest.fn() },
      product: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    logger = createMockLogger();
    repository = new CatalogRepository(prisma as unknown as PrismaService, logger);
  });

  describe('findActiveCategories', () => {
    it('returns the rows it read', async () => {
      const rows = [categoryFixture()];
      prisma.category.findMany.mockResolvedValue(rows);

      await expect(repository.findActiveCategories()).resolves.toEqual(rows);
    });

    it('reads only active categories', async () => {
      prisma.category.findMany.mockResolvedValue([]);

      await repository.findActiveCategories();

      expect(prisma.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('returns null instead of throwing when the query fails', async () => {
      prisma.category.findMany.mockRejectedValue(new Error('connection refused'));

      await expect(repository.findActiveCategories()).resolves.toBeNull();
    });
  });

  describe('findPublishedProducts', () => {
    const stubTransaction = (items: unknown[], total: number): void => {
      prisma.$transaction.mockResolvedValue([items, total]);
    };

    it('returns the page and its total', async () => {
      stubTransaction([productFixture()], 1);

      const page = await repository.findPublishedProducts(buildQuery());

      expect(page).toEqual({ items: [productFixture()], total: 1 });
    });

    it('reads the page and the count in one transaction, so they cannot disagree', async () => {
      stubTransaction([], 0);

      await repository.findPublishedProducts(buildQuery());

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('restricts to active, published products', async () => {
      stubTransaction([], 0);

      await repository.findPublishedProducts(buildQuery());

      const findArgs = prisma.product.findMany.mock.calls[0][0];
      expect(findArgs.where.isActive).toBe(true);
      expect(findArgs.where.publishedAt.not).toBeNull();
      expect(findArgs.where.publishedAt.lte).toBeInstanceOf(Date);
    });

    it('filters by category slug when one is given', async () => {
      stubTransaction([], 0);

      await repository.findPublishedProducts(buildQuery({ categorySlug: 'doi' }));

      expect(prisma.product.findMany.mock.calls[0][0].where.category).toEqual({ slug: 'doi' });
    });

    it('filters to perishables when asked', async () => {
      stubTransaction([], 0);

      await repository.findPublishedProducts(buildQuery({ perishableOnly: true }));

      expect(prisma.product.findMany.mock.calls[0][0].where.isPerishable).toBe(true);
    });

    it('searches across English name, Bangla name and brand', async () => {
      stubTransaction([], 0);

      await repository.findPublishedProducts(buildQuery({ search: 'almond' }));

      const or = prisma.product.findMany.mock.calls[0][0].where.OR;
      expect(or).toHaveLength(3);
      expect(or[0].nameEn.contains).toBe('almond');
    });

    it('ignores a search term below the minimum length instead of scanning the table', async () => {
      stubTransaction([], 0);

      await repository.findPublishedProducts(buildQuery({ search: 'a' }));

      expect(prisma.product.findMany.mock.calls[0][0].where.OR).toBeUndefined();
    });

    it('ignores a whitespace-only search term', async () => {
      stubTransaction([], 0);

      await repository.findPublishedProducts(buildQuery({ search: '   ' }));

      expect(prisma.product.findMany.mock.calls[0][0].where.OR).toBeUndefined();
    });

    it('applies the page offset derived from page and limit', async () => {
      stubTransaction([], 0);

      await repository.findPublishedProducts(buildQuery({ page: 3, limit: 20 }));

      const findArgs = prisma.product.findMany.mock.calls[0][0];
      expect(findArgs.skip).toBe(40);
      expect(findArgs.take).toBe(20);
    });

    it('orders newest-first by default', async () => {
      stubTransaction([], 0);

      await repository.findPublishedProducts(buildQuery({ sort: ProductSortOption.Newest }));

      expect(prisma.product.findMany.mock.calls[0][0].orderBy).toEqual([{ publishedAt: 'desc' }]);
    });

    it('returns null instead of throwing when the transaction fails', async () => {
      prisma.$transaction.mockRejectedValue(new Error('connection refused'));

      await expect(repository.findPublishedProducts(buildQuery())).resolves.toBeNull();
    });

    it('logs a query failure with the exception object', async () => {
      const failure = new Error('connection refused');
      prisma.$transaction.mockRejectedValue(failure);

      await repository.findPublishedProducts(buildQuery());

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: failure }),
        'Exception occurred in CatalogRepository.findPublishedProducts',
      );
    });
  });

  describe('findPublishedProductBySlug', () => {
    it('returns the matching product', async () => {
      const product = productFixture();
      prisma.product.findFirst.mockResolvedValue(product);

      await expect(repository.findPublishedProductBySlug('premium-almonds')).resolves.toEqual(
        product,
      );
    });

    it('matches on the slug within the published filter', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await repository.findPublishedProductBySlug('premium-almonds');

      const where = prisma.product.findFirst.mock.calls[0][0].where;
      expect(where.slug).toBe('premium-almonds');
      expect(where.isActive).toBe(true);
    });

    it('returns null when nothing matches', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(repository.findPublishedProductBySlug('missing')).resolves.toBeNull();
    });

    it('returns null instead of throwing when the query fails', async () => {
      prisma.product.findFirst.mockRejectedValue(new Error('connection refused'));

      await expect(repository.findPublishedProductBySlug('premium-almonds')).resolves.toBeNull();
    });
  });
});
