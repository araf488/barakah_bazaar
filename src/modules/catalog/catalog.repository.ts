import { Injectable } from '@nestjs/common';
import { Category, Prisma } from '../../infra/prisma/prisma-client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CatalogConstants, ProductSort, ProductSortOption } from './catalog.constants';
import { ProductQueryDto } from './dto/product-query.dto';

/** Relations every product projection needs. */
const productInclude = {
  category: { select: { slug: true } },
  variants: {
    where: { isActive: true },
    orderBy: [{ isDefault: 'desc' }, { pricePoysha: 'asc' }],
  },
  images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
} satisfies Prisma.ProductInclude;

export type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

export interface ProductPage {
  items: ProductWithRelations[];
  total: number;
}

/**
 * Only published, active products are ever visible to the public catalog.
 * `publishedAt <= now` is evaluated per call, so a scheduled product goes live
 * without a restart.
 */
const publishedProductWhere = (): Prisma.ProductWhereInput => ({
  isActive: true,
  publishedAt: { not: null, lte: new Date() },
});

const SORT_ORDER_BY: Record<ProductSort, Prisma.ProductOrderByWithRelationInput[]> = {
  [ProductSortOption.Newest]: [{ publishedAt: 'desc' }],
  [ProductSortOption.NameAscending]: [{ nameEn: 'asc' }],
  // Sorting by a related variant's price needs an aggregate Prisma cannot
  // express in orderBy, so the cheapest variant is already ordered first by
  // `productInclude` and the list is ordered by name for a stable page.
  [ProductSortOption.PriceAscending]: [{ nameEn: 'asc' }],
  [ProductSortOption.PriceDescending]: [{ nameEn: 'desc' }],
};

/**
 * Read-side persistence for the public catalog.
 *
 * Every method returns null on failure rather than throwing, so a database
 * fault becomes a value the service can turn into a 503.
 */
@Injectable()
export class CatalogRepository {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(CatalogRepository.name) private readonly logger: PinoLogger,
  ) {}

  /** All active categories, flat. The tree is assembled by CatalogMapper. */
  async findActiveCategories(): Promise<Category[] | null> {
    try {
      return await this.prisma.category.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
      });
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in CatalogRepository.findActiveCategories',
      );
      return null;
    }
  }

  async findPublishedProducts(query: ProductQueryDto): Promise<ProductPage | null> {
    try {
      const where = CatalogRepository.buildProductWhere(query);

      const [items, total] = await this.prisma.$transaction([
        this.prisma.product.findMany({
          where,
          include: productInclude,
          orderBy: SORT_ORDER_BY[query.sort],
          skip: query.skip,
          take: query.limit,
        }),
        this.prisma.product.count({ where }),
      ]);

      return { items, total };
    } catch (error) {
      this.logger.error(
        { err: error, categorySlug: query.categorySlug, page: query.page },
        'Exception occurred in CatalogRepository.findPublishedProducts',
      );
      return null;
    }
  }

  /**
   * Returns the product, or null for both "not found" and "query failed" —
   * the service distinguishes them by first checking database availability.
   */
  async findPublishedProductBySlug(slug: string): Promise<ProductWithRelations | null> {
    try {
      return await this.prisma.product.findFirst({
        where: { ...publishedProductWhere(), slug },
        include: productInclude,
      });
    } catch (error) {
      this.logger.error(
        { err: error, slug },
        'Exception occurred in CatalogRepository.findPublishedProductBySlug',
      );
      return null;
    }
  }

  private static buildProductWhere(query: ProductQueryDto): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = publishedProductWhere();

    if (query.categorySlug) {
      where.category = { slug: query.categorySlug };
    }

    if (query.perishableOnly) {
      where.isPerishable = true;
    }

    const term = query.search?.trim();
    if (term && term.length >= CatalogConstants.MinSearchTermLength) {
      where.OR = [
        { nameEn: { contains: term, mode: 'insensitive' } },
        { nameBn: { contains: term } },
        { brand: { contains: term, mode: 'insensitive' } },
      ];
    }

    return where;
  }
}
