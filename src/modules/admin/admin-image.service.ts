import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  ErrorMessageTemplates,
  ErrorMessages,
  formatMessage,
} from '../../common/constants/error-messages.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { ProductImage } from '../../infra/prisma/prisma-client';
import { StorageBuckets, SupabaseAdminService } from '../../infra/supabase/supabase-admin.service';
import { AuthService } from '../auth/auth.service';
import {
  AdminAuditActions,
  AdminAuditEntities,
  AdminConstants,
  AdminMessages,
} from './admin.constants';
import { AdminCatalogRepository, ImageResult } from './admin-catalog.repository';
import { AuditLogWriteData } from './audit-log.repository';
import {
  AddProductImageDto,
  ImageUploadUrlDto,
  ImageUploadUrlResponseDto,
  ProductImageDto,
  UpdateProductImageDto,
} from './dto/product-image.dto';

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Product images.
 *
 * Files never stream through this API: staff ask for a signed URL and PUT straight to
 * Supabase Storage, then register the result. That keeps a 5 MB upload off this process
 * entirely.
 *
 * The client supplies an OBJECT PATH, never a URL. A caller-supplied URL could point
 * anywhere, which would turn a product image into an arbitrary-content embed on the
 * storefront; the path is additionally required to sit under the product's own prefix, so
 * one product cannot register another's file.
 */
@Injectable()
export class AdminImageService {
  constructor(
    private readonly repository: AdminCatalogRepository,
    private readonly authService: AuthService,
    private readonly storage: SupabaseAdminService,
    @InjectPinoLogger(AdminImageService.name) private readonly logger: PinoLogger,
  ) {}

  async createUploadUrl(
    user: AuthenticatedUser,
    productId: string,
    dto: ImageUploadUrlDto,
  ): Promise<ServiceResponse<ImageUploadUrlResponseDto>> {
    try {
      const owner = await this.authService.resolveActiveUserId(user);
      if (!owner.ok) {
        return owner;
      }

      const product = await this.repository.findProductById(productId);
      if (!product) {
        return AdminImageService.missing(product, AdminConstants.ProductResourceName);
      }

      // The name is generated, not taken from the upload: a caller-chosen filename is a
      // path-traversal and collision vector, and nothing downstream needs the original.
      const extension = EXTENSIONS[dto.contentType];
      const objectPath = `${AdminImageService.prefix(productId)}${randomUUID()}.${extension}`;
      const signed = await this.storage.createSignedUploadUrl(
        StorageBuckets.ProductImages,
        objectPath,
      );

      if (!signed) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, AdminMessages.StorageUnavailable);
      }

      return serviceOk({ ...signed, objectPath });
    } catch (error) {
      this.logger.error(
        { err: error, productId },
        'Exception occurred in AdminImageService.createUploadUrl',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async addImage(
    user: AuthenticatedUser,
    productId: string,
    dto: AddProductImageDto,
  ): Promise<ServiceResponse<ProductImageDto>> {
    try {
      const owner = await this.authService.resolveActiveUserId(user);
      if (!owner.ok) {
        return owner;
      }

      const product = await this.repository.findProductById(productId);
      if (!product) {
        return AdminImageService.missing(product, AdminConstants.ProductResourceName);
      }

      // Confining the path to this product's prefix is what stops one product registering
      // another's file, or anything else that happens to sit in the bucket.
      if (!dto.objectPath.startsWith(AdminImageService.prefix(productId))) {
        return serviceFail(HttpStatus.BAD_REQUEST, AdminMessages.ImageUrlNotOurs);
      }

      const count = await this.repository.countImages(productId);
      if (count === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      if (count >= AdminConstants.MaxImagesPerProduct) {
        return serviceFail(
          HttpStatus.CONFLICT,
          formatMessage(
            AdminMessages.ImageLimitReachedTemplate,
            String(AdminConstants.MaxImagesPerProduct),
          ),
        );
      }

      const url = this.storage.getPublicUrl(StorageBuckets.ProductImages, dto.objectPath);
      if (!url) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, AdminMessages.StorageUnavailable);
      }

      const created = await this.repository.addImage(
        productId,
        { url, altText: dto.altText ?? null, makePrimary: dto.isPrimary === true },
        (image) =>
          AdminImageService.auditRow(owner.data, user, {
            action: AdminAuditActions.ImageAdded,
            entityId: image.id,
            after: image,
          }),
      );

      return AdminImageService.written(created);
    } catch (error) {
      this.logger.error(
        { err: error, productId },
        'Exception occurred in AdminImageService.addImage',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async listImages(
    user: AuthenticatedUser,
    productId: string,
  ): Promise<ServiceResponse<ProductImageDto[]>> {
    try {
      const owner = await this.authService.resolveActiveUserId(user);
      if (!owner.ok) {
        return owner;
      }

      const images = await this.repository.listImages(productId);

      if (images === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      return serviceOk(images.map((image) => AdminImageService.toDto(image)));
    } catch (error) {
      this.logger.error(
        { err: error, productId },
        'Exception occurred in AdminImageService.listImages',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async updateImage(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateProductImageDto,
  ): Promise<ServiceResponse<ProductImageDto>> {
    try {
      const owner = await this.authService.resolveActiveUserId(user);
      if (!owner.ok) {
        return owner;
      }

      const existing = await this.repository.findImageById(id);
      if (!existing) {
        return AdminImageService.missing(existing, AdminConstants.ImageResourceName);
      }

      const updated = await this.repository.updateImage(
        id,
        {
          ...(dto.altText === undefined ? {} : { altText: dto.altText }),
          ...(dto.sortOrder === undefined ? {} : { sortOrder: dto.sortOrder }),
        },
        (image) =>
          AdminImageService.auditRow(owner.data, user, {
            action: AdminAuditActions.ImageUpdated,
            entityId: image.id,
            before: existing,
            after: image,
          }),
      );

      return AdminImageService.written(updated);
    } catch (error) {
      this.logger.error(
        { err: error, imageId: id },
        'Exception occurred in AdminImageService.updateImage',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** Promotes one image to the product tile, clearing the previous primary. */
  async setPrimary(user: AuthenticatedUser, id: string): Promise<ServiceResponse<ProductImageDto>> {
    try {
      const owner = await this.authService.resolveActiveUserId(user);
      if (!owner.ok) {
        return owner;
      }

      const existing = await this.repository.findImageById(id);
      if (!existing) {
        return AdminImageService.missing(existing, AdminConstants.ImageResourceName);
      }

      const promoted = await this.repository.promoteImage(existing, (image) =>
        AdminImageService.auditRow(owner.data, user, {
          action: AdminAuditActions.ImageUpdated,
          entityId: image.id,
          before: existing,
          after: image,
        }),
      );

      return AdminImageService.written(promoted);
    } catch (error) {
      this.logger.error(
        { err: error, imageId: id },
        'Exception occurred in AdminImageService.setPrimary',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async removeImage(user: AuthenticatedUser, id: string): Promise<ServiceResponse<void>> {
    try {
      const owner = await this.authService.resolveActiveUserId(user);
      if (!owner.ok) {
        return owner;
      }

      const existing = await this.repository.findImageById(id);
      if (!existing) {
        return AdminImageService.missing(existing, AdminConstants.ImageResourceName);
      }

      const deleted = await this.repository.deleteImage(id, (image) =>
        AdminImageService.auditRow(owner.data, user, {
          action: AdminAuditActions.ImageRemoved,
          entityId: image.id,
          before: image,
        }),
      );

      if (deleted === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, AdminMessages.AuditTrailUnavailable);
      }

      if (deleted === undefined) {
        return AdminImageService.missing(deleted, AdminConstants.ImageResourceName);
      }

      return serviceOk<void>(undefined);
    } catch (error) {
      this.logger.error(
        { err: error, imageId: id },
        'Exception occurred in AdminImageService.removeImage',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Every file for a product lives under its own prefix, which is what scopes access. */
  private static prefix(productId: string): string {
    return `products/${productId}/`;
  }

  private static toDto(image: ProductImage): ProductImageDto {
    return {
      id: image.id,
      url: image.url,
      altText: image.altText,
      sortOrder: image.sortOrder,
      isPrimary: image.isPrimary,
      createdAt: image.createdAt,
    };
  }

  private static auditRow(
    actorId: string,
    user: AuthenticatedUser,
    entry: { action: string; entityId: string; before?: unknown; after?: unknown },
  ): AuditLogWriteData {
    return {
      actorId,
      actorEmail: user.email ?? null,
      actorRole: user.role,
      action: entry.action,
      entityType: AdminAuditEntities.ProductImage,
      entityId: entry.entityId,
      before: AdminImageService.toJson(entry.before),
      after: AdminImageService.toJson(entry.after),
      requestId: null,
    };
  }

  private static toJson(value: unknown): AuditLogWriteData['before'] {
    if (value === undefined || value === null) {
      return undefined;
    }

    return JSON.parse(JSON.stringify(value)) as AuditLogWriteData['before'];
  }

  private static written(result: ImageResult): ServiceResponse<ProductImageDto> {
    if (result === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, AdminMessages.AuditTrailUnavailable);
    }

    if (result === undefined) {
      return serviceFail(
        HttpStatus.NOT_FOUND,
        formatMessage(ErrorMessageTemplates.NotFound, AdminConstants.ImageResourceName),
      );
    }

    return serviceOk(AdminImageService.toDto(result));
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
}
