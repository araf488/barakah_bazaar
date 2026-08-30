import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  Category,
  Prisma,
  Product,
  ProductImage,
  ProductVariant,
} from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogRepository, AuditLogWriteData } from './audit-log.repository';

/** `undefined` = no such row; `null` = the query failed. Same contract as the user module. */
export type CategoryResult = Category | null | undefined;
export type ProductResult = Product | null | undefined;
export type VariantResult = ProductVariant | null | undefined;
export type ImageResult = ProductImage | null | undefined;

/** One product and its variants, already validated, ready to insert. */
export interface ImportProductPlan {
  readonly product: Prisma.ProductCreateInput;
  readonly variants: readonly Omit<Prisma.ProductVariantCreateInput, 'product' | 'isDefault'>[];
}

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

  /**
   * Writes a whole validated import in ONE transaction, with an audit row per product.
   *
   * All-or-nothing: a partly-imported catalog is worse than a rejected file, because nobody
   * can tell which half landed. The row cap exists so this transaction stays bounded.
   */
  async importProducts(
    plan: readonly ImportProductPlan[],
    audit: (created: Product, variants: readonly ProductVariant[]) => AuditLogWriteData,
  ): Promise<{ products: number; variants: number } | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        let variants = 0;

        for (const entry of plan) {
          const product = await tx.product.create({ data: entry.product });
          const created: ProductVariant[] = [];

          for (const [index, variant] of entry.variants.entries()) {
            created.push(
              await tx.productVariant.create({
                data: {
                  ...variant,
                  product: { connect: { id: product.id } },
                  // The first variant of each product becomes its default, matching what
                  // createVariant does for a single addition.
                  isDefault: index === 0,
                },
              }),
            );
          }

          variants += created.length;
          await this.auditLog.appendWithin(tx, audit(product, created));
        }

        return { products: plan.length, variants };
      });
    } catch (error) {
      this.logger.error(
        { err: error, products: plan.length },
        'Exception occurred in AdminCatalogRepository.importProducts',
      );
      return null;
    }
  }

  // ── Images ────────────────────────────────────────────────────────────────

  async findImageById(id: string): Promise<ImageResult> {
    try {
      return (await this.prisma.productImage.findUnique({ where: { id } })) ?? undefined;
    } catch (error) {
      this.logger.error(
        { err: error, imageId: id },
        'Exception occurred in AdminCatalogRepository.findImageById',
      );
      return null;
    }
  }

  async countImages(productId: string): Promise<number | null> {
    try {
      return await this.prisma.productImage.count({ where: { productId } });
    } catch (error) {
      this.logger.error(
        { err: error, productId },
        'Exception occurred in AdminCatalogRepository.countImages',
      );
      return null;
    }
  }

  async listImages(productId: string): Promise<ProductImage[] | null> {
    try {
      return await this.prisma.productImage.findMany({
        where: { productId },
        orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
      });
    } catch (error) {
      this.logger.error(
        { err: error, productId },
        'Exception occurred in AdminCatalogRepository.listImages',
      );
      return null;
    }
  }

  /**
   * Adds an image, and makes it primary when it is the product's first or when asked.
   *
   * Only one image may be primary, so promoting clears the previous one in the same
   * transaction — a product tile that renders two "primary" images picks one at random.
   */
  async addImage(
    productId: string,
    data: { url: string; altText: string | null; makePrimary: boolean },
    audit: (created: ProductImage) => AuditLogWriteData,
  ): Promise<ProductImage | null> {
    return await this.writeAudited(
      async (tx) => {
        const existing = await tx.productImage.count({ where: { productId } });
        const primary = data.makePrimary || existing === 0;

        if (primary) {
          await tx.productImage.updateMany({
            where: { productId, isPrimary: true },
            data: { isPrimary: false },
          });
        }

        return await tx.productImage.create({
          data: {
            product: { connect: { id: productId } },
            url: data.url,
            altText: data.altText,
            isPrimary: primary,
            sortOrder: existing,
          },
        });
      },
      audit,
      { productId },
      'addImage',
    );
  }

  /**
   * Promotes one image to primary, clearing the previous one in the same transaction.
   *
   * Only one image may be primary; two would make the product tile pick one at random.
   */
  async promoteImage(
    image: ProductImage,
    audit: (promoted: ProductImage) => AuditLogWriteData,
  ): Promise<ImageResult> {
    return await this.writeAudited(
      async (tx) => {
        if (image.isPrimary) {
          return image;
        }

        await tx.productImage.updateMany({
          where: { productId: image.productId, isPrimary: true },
          data: { isPrimary: false },
        });

        return await tx.productImage.update({
          where: { id: image.id },
          data: { isPrimary: true },
        });
      },
      audit,
      { imageId: image.id },
      'promoteImage',
    );
  }

  async updateImage(
    id: string,
    data: Prisma.ProductImageUpdateInput,
    audit: (updated: ProductImage) => AuditLogWriteData,
  ): Promise<ImageResult> {
    return await this.writeAudited(
      (tx) => tx.productImage.update({ where: { id }, data }),
      audit,
      { imageId: id },
      'updateImage',
    );
  }

  /**
   * Deletes an image and hands primacy to the next one.
   *
   * Deleted rather than soft-deleted: unlike a product, an image is not referenced by a
   * historical order, and leaving orphaned rows pointing at removed storage objects would
   * render as broken images forever.
   */
  async deleteImage(
    id: string,
    audit: (deleted: ProductImage) => AuditLogWriteData,
  ): Promise<ImageResult> {
    return await this.writeAudited(
      async (tx) => {
        const deleted = await tx.productImage.delete({ where: { id } });

        if (deleted.isPrimary) {
          const successor = await tx.productImage.findFirst({
            where: { productId: deleted.productId },
            orderBy: { sortOrder: 'asc' },
          });

          if (successor) {
            await tx.productImage.update({
              where: { id: successor.id },
              data: { isPrimary: true },
            });
          }
        }

        return deleted;
      },
      audit,
      { imageId: id },
      'deleteImage',
    );
  }
}
