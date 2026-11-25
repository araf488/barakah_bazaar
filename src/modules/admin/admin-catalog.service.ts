import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  ErrorMessageTemplates,
  ErrorMessages,
  formatMessage,
} from '../../common/constants/error-messages.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { Category, PricingMode, Product, ProductVariant } from '../../infra/prisma/prisma-client';
import { AuthService } from '../auth/auth.service';
import {
  AdminAuditActions,
  AdminAuditEntities,
  AdminConstants,
  AdminMessages,
} from './admin.constants';
import { AdminCatalogRepository } from './admin-catalog.repository';
import { AuditLogWriteData } from './audit-log.repository';
import {
  CreateCategoryDto,
  CreateProductDto,
  CreateVariantDto,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './dto/admin-catalog.dto';

/** Everything needed to stamp an audit row, resolved once per request. */
interface Actor {
  readonly id: string;
  readonly user: AuthenticatedUser;
}

/**
 * Catalog write-side for staff.
 *
 * Every mutation here goes to the repository with its audit payload, and the two are written
 * in one transaction — a price that changed without a record of who changed it is the one
 * outcome this module may not produce.
 *
 * Business rules enforced here rather than by the database, because each needs a message a
 * human can act on: slug and SKU uniqueness, the category tree staying acyclic, a product
 * needing something sellable before it may be published, and weight-priced products needing
 * a weight.
 */
@Injectable()
export class AdminCatalogService {
  constructor(
    private readonly repository: AdminCatalogRepository,
    private readonly authService: AuthService,
    @InjectPinoLogger(AdminCatalogService.name) private readonly logger: PinoLogger,
  ) {}

  // ── Categories ────────────────────────────────────────────────────────────

  async createCategory(
    user: AuthenticatedUser,
    dto: CreateCategoryDto,
  ): Promise<ServiceResponse<Category>> {
    try {
      const actor = await this.resolveActor(user);
      if (!actor.ok) {
        return actor;
      }

      const slugFree = await this.assertSlugFree(dto.slug);
      if (!slugFree.ok) {
        return slugFree;
      }

      const parent = await this.assertParentUsable(dto.parentId ?? null);
      if (!parent.ok) {
        return parent;
      }

      const created = await this.repository.createCategory(
        {
          slug: dto.slug,
          nameEn: dto.nameEn,
          nameBn: dto.nameBn,
          imageUrl: dto.imageUrl ?? null,
          sortOrder: dto.sortOrder ?? 0,
          ...(dto.parentId ? { parent: { connect: { id: dto.parentId } } } : {}),
        },
        (category) =>
          AdminCatalogService.auditRow(actor.data, {
            action: AdminAuditActions.CategoryCreated,
            entityType: AdminAuditEntities.Category,
            entityId: category.id,
            after: category,
          }),
      );

      return AdminCatalogService.written(created, AdminConstants.CategoryResourceName);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AdminCatalogService.createCategory');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async updateCategory(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<ServiceResponse<Category>> {
    try {
      const actor = await this.resolveActor(user);
      if (!actor.ok) {
        return actor;
      }

      const existing = await this.repository.findCategoryById(id);
      if (!existing) {
        return AdminCatalogService.missing(existing, AdminConstants.CategoryResourceName);
      }

      const guard = await this.guardCategoryUpdate(existing, dto);
      if (!guard.ok) {
        return guard;
      }

      const updated = await this.repository.updateCategory(
        id,
        {
          ...(dto.slug === undefined ? {} : { slug: dto.slug }),
          ...(dto.nameEn === undefined ? {} : { nameEn: dto.nameEn }),
          ...(dto.nameBn === undefined ? {} : { nameBn: dto.nameBn }),
          ...(dto.imageUrl === undefined ? {} : { imageUrl: dto.imageUrl }),
          ...(dto.sortOrder === undefined ? {} : { sortOrder: dto.sortOrder }),
          ...(dto.parentId === undefined
            ? {}
            : { parent: dto.parentId ? { connect: { id: dto.parentId } } : { disconnect: true } }),
        },
        (category) =>
          AdminCatalogService.auditRow(actor.data, {
            action: AdminAuditActions.CategoryUpdated,
            entityType: AdminAuditEntities.Category,
            entityId: category.id,
            before: existing,
            after: category,
          }),
      );

      return AdminCatalogService.written(updated, AdminConstants.CategoryResourceName);
    } catch (error) {
      this.logger.error(
        { err: error, categoryId: id },
        'Exception occurred in AdminCatalogService.updateCategory',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** Deactivates rather than deletes: catalog rows are referenced by historical orders. */
  async deactivateCategory(
    user: AuthenticatedUser,
    id: string,
  ): Promise<ServiceResponse<Category>> {
    try {
      const actor = await this.resolveActor(user);
      if (!actor.ok) {
        return actor;
      }

      const existing = await this.repository.findCategoryById(id);
      if (!existing) {
        return AdminCatalogService.missing(existing, AdminConstants.CategoryResourceName);
      }

      const dependents = await this.repository.countCategoryDependents(id);
      if (dependents === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      // Hiding a category whose products are still live would orphan them in the storefront:
      // reachable by direct link, invisible in navigation.
      if (dependents > 0) {
        return serviceFail(HttpStatus.CONFLICT, AdminMessages.CategoryInUse);
      }

      const updated = await this.repository.updateCategory(id, { isActive: false }, (category) =>
        AdminCatalogService.auditRow(actor.data, {
          action: AdminAuditActions.CategoryDeactivated,
          entityType: AdminAuditEntities.Category,
          entityId: category.id,
          before: existing,
          after: category,
        }),
      );

      return AdminCatalogService.written(updated, AdminConstants.CategoryResourceName);
    } catch (error) {
      this.logger.error(
        { err: error, categoryId: id },
        'Exception occurred in AdminCatalogService.deactivateCategory',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  // ── Shared guards ─────────────────────────────────────────────────────────

  private async guardCategoryUpdate(
    existing: Category,
    dto: UpdateCategoryDto,
  ): Promise<ServiceResponse<void>> {
    if (dto.slug !== undefined && dto.slug !== existing.slug) {
      const free = await this.assertSlugFree(dto.slug);
      if (!free.ok) {
        return free;
      }
    }

    if (dto.parentId === undefined) {
      return serviceOk<void>(undefined);
    }

    const parent = await this.assertParentUsable(dto.parentId);
    if (!parent.ok) {
      return parent;
    }

    return await this.assertNoCycle(existing.id, dto.parentId);
  }

  private async assertSlugFree(slug: string): Promise<ServiceResponse<void>> {
    const clash = await this.repository.findCategoryBySlug(slug);

    if (clash === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    if (clash !== undefined) {
      return serviceFail(HttpStatus.CONFLICT, formatMessage(AdminMessages.SlugTakenTemplate, slug));
    }

    return serviceOk<void>(undefined);
  }

  private async assertParentUsable(parentId: string | null): Promise<ServiceResponse<void>> {
    if (!parentId) {
      return serviceOk<void>(undefined);
    }

    const parent = await this.repository.findCategoryById(parentId);

    if (parent === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    if (parent === undefined || !parent.isActive) {
      return serviceFail(HttpStatus.BAD_REQUEST, AdminMessages.ParentCategoryUnavailable);
    }

    return serviceOk<void>(undefined);
  }

  /**
   * Refuses a move that would put a category beneath itself.
   *
   * A cycle in the tree makes the storefront's category walk loop forever, and the database
   * cannot express the constraint.
   */
  private async assertNoCycle(
    categoryId: string,
    parentId: string | null,
  ): Promise<ServiceResponse<void>> {
    if (!parentId) {
      return serviceOk<void>(undefined);
    }

    if (parentId === categoryId) {
      return serviceFail(HttpStatus.BAD_REQUEST, AdminMessages.CategoryCycle);
    }

    const ancestors = await this.repository.findAncestorIds(parentId);

    if (ancestors === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    if (ancestors.includes(categoryId)) {
      return serviceFail(HttpStatus.BAD_REQUEST, AdminMessages.CategoryCycle);
    }

    return serviceOk<void>(undefined);
  }

  // ── Result helpers ────────────────────────────────────────────────────────

  private async resolveActor(user: AuthenticatedUser): Promise<ServiceResponse<Actor>> {
    const resolved = await this.authService.resolveActiveUserId(user);

    if (!resolved.ok) {
      return resolved;
    }

    return serviceOk({ id: resolved.data, user });
  }

  private static auditRow(
    actor: Actor,
    entry: Pick<AuditLogWriteData, 'action' | 'entityType' | 'entityId'> & {
      before?: unknown;
      after?: unknown;
    },
  ): AuditLogWriteData {
    return {
      actorId: actor.id,
      actorEmail: actor.user.email ?? null,
      actorRole: actor.user.role,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: AdminCatalogService.toJson(entry.before),
      after: AdminCatalogService.toJson(entry.after),
      requestId: null,
    };
  }

  /** Prices are BigInt poysha, which a JSON column cannot hold. */
  private static toJson(value: unknown): AuditLogWriteData['before'] {
    if (value === undefined || value === null) {
      return undefined;
    }

    return JSON.parse(
      JSON.stringify(value, (_key, item: unknown) =>
        typeof item === 'bigint' ? Number(item) : item,
      ),
    ) as AuditLogWriteData['before'];
  }

  /** `null` from a write means the transaction failed — including its audit row. */
  private static written<T>(result: T | null | undefined, resource: string): ServiceResponse<T> {
    if (result === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, AdminMessages.AuditTrailUnavailable);
    }

    if (result === undefined) {
      return serviceFail(
        HttpStatus.NOT_FOUND,
        formatMessage(ErrorMessageTemplates.NotFound, resource),
      );
    }

    return serviceOk(result);
  }

  private static missing<T>(result: null | undefined, resource: string): ServiceResponse<T> {
    if (result === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    return serviceFail(
      HttpStatus.NOT_FOUND,
      formatMessage(ErrorMessageTemplates.NotFound, resource),
    );
  }

  // ── Products ──────────────────────────────────────────────────────────────

  async createProduct(
    user: AuthenticatedUser,
    dto: CreateProductDto,
  ): Promise<ServiceResponse<Product>> {
    try {
      const actor = await this.resolveActor(user);
      if (!actor.ok) {
        return actor;
      }

      const guard = await this.guardProductWrite(dto.slug, dto.categoryId);
      if (!guard.ok) {
        return guard;
      }

      const created = await this.repository.createProduct(
        {
          slug: dto.slug,
          nameEn: dto.nameEn,
          nameBn: dto.nameBn,
          descriptionEn: dto.descriptionEn ?? null,
          descriptionBn: dto.descriptionBn ?? null,
          brand: dto.brand ?? null,
          pricingMode: dto.pricingMode ?? PricingMode.UNIT,
          isPerishable: dto.isPerishable ?? false,
          shelfLifeHours: dto.shelfLifeHours ?? null,
          ...(dto.storageType ? { storageType: dto.storageType } : {}),
          maxDeliveryDistanceKm: dto.maxDeliveryDistanceKm ?? null,
          category: { connect: { id: dto.categoryId } },
        },
        (product) =>
          AdminCatalogService.auditRow(actor.data, {
            action: AdminAuditActions.ProductCreated,
            entityType: AdminAuditEntities.Product,
            entityId: product.id,
            after: product,
          }),
      );

      return AdminCatalogService.written(created, AdminConstants.ProductResourceName);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AdminCatalogService.createProduct');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async updateProduct(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateProductDto,
  ): Promise<ServiceResponse<Product>> {
    try {
      const actor = await this.resolveActor(user);
      if (!actor.ok) {
        return actor;
      }

      const existing = await this.repository.findProductById(id);
      if (!existing) {
        return AdminCatalogService.missing(existing, AdminConstants.ProductResourceName);
      }

      const guard = await this.guardProductWrite(
        dto.slug !== undefined && dto.slug !== existing.slug ? dto.slug : null,
        dto.categoryId ?? null,
      );
      if (!guard.ok) {
        return guard;
      }

      const updated = await this.repository.updateProduct(
        id,
        AdminCatalogService.toProductUpdate(dto),
        (product) =>
          AdminCatalogService.auditRow(actor.data, {
            action: AdminAuditActions.ProductUpdated,
            entityType: AdminAuditEntities.Product,
            entityId: product.id,
            before: existing,
            after: product,
          }),
      );

      return AdminCatalogService.written(updated, AdminConstants.ProductResourceName);
    } catch (error) {
      this.logger.error(
        { err: error, productId: id },
        'Exception occurred in AdminCatalogService.updateProduct',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Makes a product visible to customers.
   *
   * Refuses a product with nothing sellable: the public catalog shows a "from" price computed
   * across active variants, so publishing without one puts an item on the storefront at zero
   * that nobody can add to a cart.
   */
  async publishProduct(user: AuthenticatedUser, id: string): Promise<ServiceResponse<Product>> {
    try {
      const actor = await this.resolveActor(user);
      if (!actor.ok) {
        return actor;
      }

      const existing = await this.repository.findProductById(id);
      if (!existing) {
        return AdminCatalogService.missing(existing, AdminConstants.ProductResourceName);
      }

      const variants = await this.repository.countActiveVariants(id);
      if (variants === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      if (variants === 0) {
        return serviceFail(HttpStatus.CONFLICT, AdminMessages.PublishNeedsVariant);
      }

      const updated = await this.repository.updateProduct(
        id,
        { publishedAt: new Date(), isActive: true },
        (product) =>
          AdminCatalogService.auditRow(actor.data, {
            action: AdminAuditActions.ProductPublished,
            entityType: AdminAuditEntities.Product,
            entityId: product.id,
            before: existing,
            after: product,
          }),
      );

      return AdminCatalogService.written(updated, AdminConstants.ProductResourceName);
    } catch (error) {
      this.logger.error(
        { err: error, productId: id },
        'Exception occurred in AdminCatalogService.publishProduct',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** Hides a product without deleting it — historical orders still reference the row. */
  async unpublishProduct(user: AuthenticatedUser, id: string): Promise<ServiceResponse<Product>> {
    try {
      const actor = await this.resolveActor(user);
      if (!actor.ok) {
        return actor;
      }

      const existing = await this.repository.findProductById(id);
      if (!existing) {
        return AdminCatalogService.missing(existing, AdminConstants.ProductResourceName);
      }

      const updated = await this.repository.updateProduct(id, { publishedAt: null }, (product) =>
        AdminCatalogService.auditRow(actor.data, {
          action: AdminAuditActions.ProductUnpublished,
          entityType: AdminAuditEntities.Product,
          entityId: product.id,
          before: existing,
          after: product,
        }),
      );

      return AdminCatalogService.written(updated, AdminConstants.ProductResourceName);
    } catch (error) {
      this.logger.error(
        { err: error, productId: id },
        'Exception occurred in AdminCatalogService.unpublishProduct',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  // ── Variants ──────────────────────────────────────────────────────────────

  async createVariant(
    user: AuthenticatedUser,
    productId: string,
    dto: CreateVariantDto,
  ): Promise<ServiceResponse<ProductVariant>> {
    try {
      const actor = await this.resolveActor(user);
      if (!actor.ok) {
        return actor;
      }

      const product = await this.repository.findProductById(productId);
      if (!product) {
        return AdminCatalogService.missing(product, AdminConstants.ProductResourceName);
      }

      const guard = await this.guardVariantWrite(product, dto.sku, dto);
      if (!guard.ok) {
        return guard;
      }

      const created = await this.repository.createVariant(
        productId,
        {
          sku: dto.sku,
          nameEn: dto.nameEn,
          nameBn: dto.nameBn,
          pricePoysha: BigInt(dto.pricePoysha),
          compareAtPricePoysha:
            dto.compareAtPricePoysha === undefined || dto.compareAtPricePoysha === null
              ? null
              : BigInt(dto.compareAtPricePoysha),
          weightGrams: dto.weightGrams ?? null,
          unitLabel: dto.unitLabel,
        },
        (variant) =>
          AdminCatalogService.auditRow(actor.data, {
            action: AdminAuditActions.VariantCreated,
            entityType: AdminAuditEntities.ProductVariant,
            entityId: variant.id,
            after: variant,
          }),
      );

      return AdminCatalogService.written(created, AdminConstants.VariantResourceName);
    } catch (error) {
      this.logger.error(
        { err: error, productId },
        'Exception occurred in AdminCatalogService.createVariant',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async updateVariant(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateVariantDto,
  ): Promise<ServiceResponse<ProductVariant>> {
    try {
      const actor = await this.resolveActor(user);
      if (!actor.ok) {
        return actor;
      }

      const existing = await this.repository.findVariantById(id);
      if (!existing) {
        return AdminCatalogService.missing(existing, AdminConstants.VariantResourceName);
      }

      const product = await this.repository.findProductById(existing.productId);
      if (!product) {
        return AdminCatalogService.missing(product, AdminConstants.ProductResourceName);
      }

      const guard = await this.guardVariantWrite(
        product,
        dto.sku !== undefined && dto.sku !== existing.sku ? dto.sku : null,
        { ...dto, weightGrams: dto.weightGrams ?? existing.weightGrams },
      );
      if (!guard.ok) {
        return guard;
      }

      const updated = await this.repository.updateVariant(
        id,
        AdminCatalogService.toVariantUpdate(dto),
        (variant) =>
          AdminCatalogService.auditRow(actor.data, {
            action: AdminAuditActions.VariantUpdated,
            entityType: AdminAuditEntities.ProductVariant,
            entityId: variant.id,
            before: existing,
            after: variant,
          }),
      );

      return AdminCatalogService.written(updated, AdminConstants.VariantResourceName);
    } catch (error) {
      this.logger.error(
        { err: error, variantId: id },
        'Exception occurred in AdminCatalogService.updateVariant',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  // ── Product and variant guards ────────────────────────────────────────────

  /** `slug` and `categoryId` are null when the caller is not changing them. */
  private async guardProductWrite(
    slug: string | null,
    categoryId: string | null,
  ): Promise<ServiceResponse<void>> {
    if (slug) {
      const clash = await this.repository.findProductBySlug(slug);

      if (clash === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      if (clash !== undefined) {
        return serviceFail(
          HttpStatus.CONFLICT,
          formatMessage(AdminMessages.SlugTakenTemplate, slug),
        );
      }
    }

    if (!categoryId) {
      return serviceOk<void>(undefined);
    }

    const category = await this.repository.findCategoryById(categoryId);

    if (category === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    if (category === undefined || !category.isActive) {
      return serviceFail(HttpStatus.BAD_REQUEST, AdminMessages.CategoryUnavailable);
    }

    return serviceOk<void>(undefined);
  }

  private async guardVariantWrite(
    product: Product,
    sku: string | null,
    prices: {
      pricePoysha?: number;
      compareAtPricePoysha?: number | null;
      weightGrams?: number | null;
    },
  ): Promise<ServiceResponse<void>> {
    if (sku) {
      const clash = await this.repository.findVariantBySku(sku);

      if (clash === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      if (clash !== undefined) {
        return serviceFail(HttpStatus.CONFLICT, formatMessage(AdminMessages.SkuTakenTemplate, sku));
      }
    }

    // A weight-priced product whose variant has no weight cannot have its price computed at
    // cart time — Money.forWeight has nothing to multiply.
    if (product.pricingMode === PricingMode.WEIGHT && !prices.weightGrams) {
      return serviceFail(HttpStatus.BAD_REQUEST, AdminMessages.WeightRequired);
    }

    const price = prices.pricePoysha;
    const compareAt = prices.compareAtPricePoysha;

    // compareAtPrice is the struck-through "was" price. Below the selling price it would
    // render as a price increase dressed up as a discount.
    if (
      price !== undefined &&
      compareAt !== undefined &&
      compareAt !== null &&
      compareAt <= price
    ) {
      return serviceFail(HttpStatus.BAD_REQUEST, AdminMessages.CompareAtPriceTooLow);
    }

    return serviceOk<void>(undefined);
  }

  private static toProductUpdate(dto: UpdateProductDto): Record<string, unknown> {
    return {
      ...(dto.slug === undefined ? {} : { slug: dto.slug }),
      ...(dto.nameEn === undefined ? {} : { nameEn: dto.nameEn }),
      ...(dto.nameBn === undefined ? {} : { nameBn: dto.nameBn }),
      ...(dto.descriptionEn === undefined ? {} : { descriptionEn: dto.descriptionEn }),
      ...(dto.descriptionBn === undefined ? {} : { descriptionBn: dto.descriptionBn }),
      ...(dto.brand === undefined ? {} : { brand: dto.brand }),
      ...(dto.pricingMode === undefined ? {} : { pricingMode: dto.pricingMode }),
      ...(dto.isPerishable === undefined ? {} : { isPerishable: dto.isPerishable }),
      ...(dto.shelfLifeHours === undefined ? {} : { shelfLifeHours: dto.shelfLifeHours }),
      ...(dto.storageType === undefined ? {} : { storageType: dto.storageType }),
      ...(dto.maxDeliveryDistanceKm === undefined
        ? {}
        : { maxDeliveryDistanceKm: dto.maxDeliveryDistanceKm }),
      ...(dto.categoryId === undefined ? {} : { category: { connect: { id: dto.categoryId } } }),
    };
  }

  private static toVariantUpdate(dto: UpdateVariantDto): Record<string, unknown> {
    return {
      ...(dto.sku === undefined ? {} : { sku: dto.sku }),
      ...(dto.nameEn === undefined ? {} : { nameEn: dto.nameEn }),
      ...(dto.nameBn === undefined ? {} : { nameBn: dto.nameBn }),
      ...(dto.pricePoysha === undefined ? {} : { pricePoysha: BigInt(dto.pricePoysha) }),
      ...(dto.compareAtPricePoysha === undefined
        ? {}
        : {
            compareAtPricePoysha:
              dto.compareAtPricePoysha === null ? null : BigInt(dto.compareAtPricePoysha),
          }),
      ...(dto.weightGrams === undefined ? {} : { weightGrams: dto.weightGrams }),
      ...(dto.unitLabel === undefined ? {} : { unitLabel: dto.unitLabel }),
    };
  }
}
