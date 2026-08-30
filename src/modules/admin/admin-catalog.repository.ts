import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Category, Prisma, Product, ProductVariant } from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogRepository, AuditLogWriteData } from './audit-log.repository';

/** `undefined` = no such row; `null` = the query failed. Same contract as the user module. */
export type CategoryResult = Category | null | undefined;
export type ProductResult = Product | null | undefined;
export type VariantResult = ProductVariant | null | undefined;

/**
 * Write-side catalog persistence for staff.
 *
 * Distinct from `CatalogRepository`, which is the public read side and only ever returns
 * published, active rows. Staff must see drafts and deactivated items — merging the two
 * would mean one predicate serving two opposite audiences, and the storefront would
 * eventually leak an unpublished product.
 */
@Injectable()
export class AdminCatalogRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogRepository,
    @InjectPinoLogger(AdminCatalogRepository.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Performs a staff write and its audit row in ONE transaction.
   *
   * Every mutation on this repository goes through here. Prices and visibility are what this
   * module changes, so a write whose audit row failed must not stand — an unexplained price
   * is worse than a rejected edit the operator can retry.
   *
   * The audit payload is a function of the result because the row's id is usually not known
   * until the write has happened.
   */
  private async writeAudited<TResult>(
    write: (tx: Prisma.TransactionClient) => Promise<TResult>,
    audit: (result: TResult) => AuditLogWriteData,
    context: Record<string, unknown>,
    method: string,
  ): Promise<TResult | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const result = await write(tx);
        await this.auditLog.appendWithin(tx, audit(result));
        return result;
      });
    } catch (error) {
      this.logger.error(
        { err: error, ...context },
        `Exception occurred in AdminCatalogRepository.${method}`,
      );
      return null;
    }
  }

  // ── Categories ────────────────────────────────────────────────────────────

  async findCategoryById(id: string): Promise<CategoryResult> {
    try {
      return (await this.prisma.category.findUnique({ where: { id } })) ?? undefined;
    } catch (error) {
      this.logger.error(
        { err: error, categoryId: id },
        'Exception occurred in AdminCatalogRepository.findCategoryById',
      );
      return null;
    }
  }

  async findCategoryBySlug(slug: string): Promise<CategoryResult> {
    try {
      return (await this.prisma.category.findUnique({ where: { slug } })) ?? undefined;
    } catch (error) {
      this.logger.error(
        { err: error, slug },
        'Exception occurred in AdminCatalogRepository.findCategoryBySlug',
      );
      return null;
    }
  }

  async createCategory(
    data: Prisma.CategoryCreateInput,
    audit: (created: Category) => AuditLogWriteData,
  ): Promise<Category | null> {
    return await this.writeAudited(
      (tx) => tx.category.create({ data }),
      audit,
      { slug: data.slug },
      'createCategory',
    );
  }

  async updateCategory(
    id: string,
    data: Prisma.CategoryUpdateInput,
    audit: (updated: Category) => AuditLogWriteData,
  ): Promise<CategoryResult> {
    return await this.writeAudited(
      (tx) => tx.category.update({ where: { id }, data }),
      audit,
      { categoryId: id },
      'updateCategory',
    );
  }

  /** Live dependents that block deactivating a category. */
  async countCategoryDependents(id: string): Promise<number | null> {
    try {
      const [products, children] = await this.prisma.$transaction([
        this.prisma.product.count({ where: { categoryId: id, isActive: true } }),
        this.prisma.category.count({ where: { parentId: id, isActive: true } }),
      ]);

      return products + children;
    } catch (error) {
      this.logger.error(
        { err: error, categoryId: id },
        'Exception occurred in AdminCatalogRepository.countCategoryDependents',
      );
      return null;
    }
  }

  /**
   * The ancestor chain of a category, nearest first.
   *
   * Used to reject a move that would make a category its own ancestor — a cycle in the tree
   * makes the storefront's category walk loop forever.
   */
  async findAncestorIds(startId: string): Promise<string[] | null> {
    try {
      const ancestors: string[] = [];
      let current = await this.prisma.category.findUnique({
        where: { id: startId },
        select: { parentId: true },
      });

      // Bounded by the number of categories, so a pre-existing cycle cannot hang the request.
      while (current?.parentId && ancestors.length < AdminCatalogRepository.MaxTreeDepth) {
        ancestors.push(current.parentId);
        current = await this.prisma.category.findUnique({
          where: { id: current.parentId },
          select: { parentId: true },
        });
      }

      return ancestors;
    } catch (error) {
      this.logger.error(
        { err: error, categoryId: startId },
        'Exception occurred in AdminCatalogRepository.findAncestorIds',
      );
      return null;
    }
  }

  private static readonly MaxTreeDepth = 32;

  // ── Products ──────────────────────────────────────────────────────────────

  async findProductById(id: string): Promise<ProductResult> {
    try {
      return (await this.prisma.product.findUnique({ where: { id } })) ?? undefined;
    } catch (error) {
      this.logger.error(
        { err: error, productId: id },
        'Exception occurred in AdminCatalogRepository.findProductById',
      );
      return null;
    }
  }

  async findProductBySlug(slug: string): Promise<ProductResult> {
    try {
      return (await this.prisma.product.findUnique({ where: { slug } })) ?? undefined;
    } catch (error) {
      this.logger.error(
        { err: error, slug },
        'Exception occurred in AdminCatalogRepository.findProductBySlug',
      );
      return null;
    }
  }

  async createProduct(
    data: Prisma.ProductCreateInput,
    audit: (created: Product) => AuditLogWriteData,
  ): Promise<Product | null> {
    return await this.writeAudited(
      (tx) => tx.product.create({ data }),
      audit,
      { slug: data.slug },
      'createProduct',
    );
  }

  async updateProduct(
    id: string,
    data: Prisma.ProductUpdateInput,
    audit: (updated: Product) => AuditLogWriteData,
  ): Promise<ProductResult> {
    return await this.writeAudited(
      (tx) => tx.product.update({ where: { id }, data }),
      audit,
      { productId: id },
      'updateProduct',
    );
  }

  async countActiveVariants(productId: string): Promise<number | null> {
    try {
      return await this.prisma.productVariant.count({ where: { productId, isActive: true } });
    } catch (error) {
      this.logger.error(
        { err: error, productId },
        'Exception occurred in AdminCatalogRepository.countActiveVariants',
      );
      return null;
    }
  }

  // ── Variants ──────────────────────────────────────────────────────────────

  async findVariantById(id: string): Promise<VariantResult> {
    try {
      return (await this.prisma.productVariant.findUnique({ where: { id } })) ?? undefined;
    } catch (error) {
      this.logger.error(
        { err: error, variantId: id },
        'Exception occurred in AdminCatalogRepository.findVariantById',
      );
      return null;
    }
  }

  async findVariantBySku(sku: string): Promise<VariantResult> {
    try {
      return (await this.prisma.productVariant.findUnique({ where: { sku } })) ?? undefined;
    } catch (error) {
      this.logger.error(
        { err: error, sku },
        'Exception occurred in AdminCatalogRepository.findVariantBySku',
      );
      return null;
    }
  }

  /**
   * Creates a variant, making it the default when it is the product's first.
   *
   * Counted inside the transaction so two simultaneous first variants cannot both claim it.
   */
  async createVariant(
    productId: string,
    data: Omit<Prisma.ProductVariantCreateInput, 'product' | 'isDefault'>,
    audit: (created: ProductVariant) => AuditLogWriteData,
  ): Promise<ProductVariant | null> {
    return await this.writeAudited(
      async (tx) => {
        const existing = await tx.productVariant.count({ where: { productId, isActive: true } });

        return await tx.productVariant.create({
          data: { ...data, product: { connect: { id: productId } }, isDefault: existing === 0 },
        });
      },
      audit,
      { productId },
      'createVariant',
    );
  }

  async updateVariant(
    id: string,
    data: Prisma.ProductVariantUpdateInput,
    audit: (updated: ProductVariant) => AuditLogWriteData,
  ): Promise<VariantResult> {
    return await this.writeAudited(
      (tx) => tx.productVariant.update({ where: { id }, data }),
      audit,
      { variantId: id },
      'updateVariant',
    );
  }

  /** Clears the previous default before setting the new one, in one transaction. */
  async promoteDefaultVariant(productId: string, variantId: string): Promise<VariantResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const target = await tx.productVariant.findFirst({
          where: { id: variantId, productId, isActive: true },
        });

        if (!target) {
          return undefined;
        }

        if (target.isDefault) {
          return target;
        }

        await tx.productVariant.updateMany({
          where: { productId, isDefault: true },
          data: { isDefault: false },
        });

        return await tx.productVariant.update({
          where: { id: target.id },
          data: { isDefault: true },
        });
      });
    } catch (error) {
      this.logger.error(
        { err: error, productId, variantId },
        'Exception occurred in AdminCatalogRepository.promoteDefaultVariant',
      );
      return null;
    }
  }
}
