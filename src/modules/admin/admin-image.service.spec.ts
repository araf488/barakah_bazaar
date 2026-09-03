import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { SupabaseAdminService } from '../../infra/supabase/supabase-admin.service';
import { createMockLogger } from '../../../test/support/mocks';
import { AuthService } from '../auth/auth.service';
import { AdminCatalogRepository } from './admin-catalog.repository';
import { AdminImageService } from './admin-image.service';
import { AddProductImageDto, ImageUploadUrlDto } from './dto/product-image.dto';

const actor: AuthenticatedUser = {
  userId: '11111111-1111-1111-1111-111111111111',
  sessionId: 'session-1',
  email: 'marketing@barakahbazaar.com.bd',
  role: UserRole.MARKETING,
};

const PRODUCT = 'prod-1';
const PREFIX = `products/${PRODUCT}/`;

const image = (overrides = {}) => ({
  id: 'img-1',
  productId: PRODUCT,
  url: 'https://cdn.test/product-images/a.jpg',
  altText: null,
  sortOrder: 0,
  isPrimary: true,
  createdAt: new Date('2026-08-30T00:00:00.000Z'),
  ...overrides,
});

describe('AdminImageService', () => {
  let repository: Record<string, jest.Mock>;
  let authService: { resolveActiveUserId: jest.Mock };
  let storage: { createSignedUploadUrl: jest.Mock; getPublicUrl: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: AdminImageService;

  beforeEach(() => {
    repository = {
      findProductById: jest.fn().mockResolvedValue({ id: PRODUCT }),
      findImageById: jest.fn().mockResolvedValue(image()),
      countImages: jest.fn().mockResolvedValue(0),
      listImages: jest.fn().mockResolvedValue([image()]),
      addImage: jest.fn().mockResolvedValue(image()),
      updateImage: jest.fn().mockResolvedValue(image()),
      promoteImage: jest.fn().mockResolvedValue(image()),
      deleteImage: jest.fn().mockResolvedValue(image()),
    };
    authService = {
      resolveActiveUserId: jest.fn().mockResolvedValue({ ok: true, data: 'user-1' }),
    };
    storage = {
      createSignedUploadUrl: jest
        .fn()
        .mockResolvedValue({ signedUrl: 'https://upload', token: 't', expiresInSeconds: 300 }),
      getPublicUrl: jest.fn().mockReturnValue('https://cdn.test/product-images/a.jpg'),
    };
    logger = createMockLogger();
    service = new AdminImageService(
      repository as unknown as AdminCatalogRepository,
      authService as unknown as AuthService,
      storage as unknown as SupabaseAdminService,
      logger,
    );
  });

  const uploadDto = (contentType = 'image/jpeg'): ImageUploadUrlDto =>
    Object.assign(new ImageUploadUrlDto(), { fileName: 'photo.jpg', contentType });

  const addDto = (objectPath: string): AddProductImageDto =>
    Object.assign(new AddProductImageDto(), { objectPath });

  describe('createUploadUrl', () => {
    it('generates the object path rather than trusting the supplied filename', async () => {
      // A caller-chosen filename is a path-traversal and collision vector.
      const result = await service.createUploadUrl(actor, PRODUCT, uploadDto());

      expect(result.ok && result.data.objectPath).toMatch(
        new RegExp(`^products/${PRODUCT}/[0-9a-f-]{36}\\.jpg$`),
      );
      expect(result.ok && result.data.objectPath).not.toContain('photo.jpg');
    });

    it.each([
      ['image/jpeg', 'jpg'],
      ['image/png', 'png'],
      ['image/webp', 'webp'],
    ])('uses the extension matching %s', async (contentType, extension) => {
      const result = await service.createUploadUrl(actor, PRODUCT, uploadDto(contentType));

      expect(result.ok && result.data.objectPath.endsWith(`.${extension}`)).toBe(true);
    });

    it('answers 404 for a product that does not exist', async () => {
      repository.findProductById.mockResolvedValue(undefined);

      const result = await service.createUploadUrl(actor, PRODUCT, uploadDto());

      expect(!result.ok && result.status).toBe(HttpStatus.NOT_FOUND);
      expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
    });

    it('answers 503 when storage is unconfigured', async () => {
      storage.createSignedUploadUrl.mockResolvedValue(null);

      const result = await service.createUploadUrl(actor, PRODUCT, uploadDto());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Image uploads are not available right now.',
      });
    });
  });

  describe('addImage', () => {
    it('registers an image under the product prefix', async () => {
      const result = await service.addImage(actor, PRODUCT, addDto(`${PREFIX}abc.jpg`));

      expect(result.ok && result.data.id).toBe('img-1');
    });

    it('builds the URL server-side rather than accepting one', async () => {
      // A caller-supplied URL could point anywhere, turning a product image into an
      // arbitrary-content embed on the storefront.
      await service.addImage(actor, PRODUCT, addDto(`${PREFIX}abc.jpg`));

      expect(storage.getPublicUrl).toHaveBeenCalledWith('product-images', `${PREFIX}abc.jpg`);
      expect(repository.addImage.mock.calls[0][1].url).toBe(
        'https://cdn.test/product-images/a.jpg',
      );
    });

    it.each([
      ["another product's prefix", 'products/prod-9/abc.jpg'],
      ['the bucket root', 'abc.jpg'],
      ['a traversal attempt', `${PREFIX}../prod-9/abc.jpg`.replace(`products/${PRODUCT}/`, '')],
      ['someone else’s folder', 'vendor-documents/secret.pdf'],
    ])('refuses an object path outside this product — %s', async (_label, objectPath) => {
      const result = await service.addImage(actor, PRODUCT, addDto(objectPath));

      expect(!result.ok && result.status).toBe(HttpStatus.BAD_REQUEST);
      expect(repository.addImage).not.toHaveBeenCalled();
    });

    it('refuses once the image limit is reached', async () => {
      repository.countImages.mockResolvedValue(10);

      const result = await service.addImage(actor, PRODUCT, addDto(`${PREFIX}abc.jpg`));

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'A product may have at most 10 images. Remove one before adding another.',
      });
    });

    it('allows the tenth image', async () => {
      repository.countImages.mockResolvedValue(9);

      const result = await service.addImage(actor, PRODUCT, addDto(`${PREFIX}abc.jpg`));

      expect(result.ok).toBe(true);
    });

    it('passes the primary request through to the repository', async () => {
      const dto = Object.assign(addDto(`${PREFIX}abc.jpg`), { isPrimary: true });

      await service.addImage(actor, PRODUCT, dto);

      expect(repository.addImage.mock.calls[0][1].makePrimary).toBe(true);
    });

    it('records the addition in the audit trail', async () => {
      await service.addImage(actor, PRODUCT, addDto(`${PREFIX}abc.jpg`));

      const build = repository.addImage.mock.calls[0][2] as (
        row: unknown,
      ) => Record<string, unknown>;
      const audit = build(image());
      expect(audit.action).toBe('product_image.added');
      expect(audit.entityType).toBe('ProductImage');
    });
  });

  describe('setPrimary and remove', () => {
    it('promotes an image to the product tile', async () => {
      const result = await service.setPrimary(actor, 'img-1');

      expect(result.ok).toBe(true);
      expect(repository.promoteImage).toHaveBeenCalledWith(image(), expect.any(Function));
    });

    it('removes an image and returns no body', async () => {
      await expect(service.removeImage(actor, 'img-1')).resolves.toEqual({
        ok: true,
        data: undefined,
      });
    });

    it('records the removal with the deleted row as the before state', async () => {
      await service.removeImage(actor, 'img-1');

      const build = repository.deleteImage.mock.calls[0][1] as (
        row: unknown,
      ) => Record<string, unknown>;
      const audit = build(image());
      expect(audit.action).toBe('product_image.removed');
      expect(audit.before).toBeDefined();
      expect(audit.after).toBeUndefined();
    });

    it('answers 404 for an image that does not exist', async () => {
      repository.findImageById.mockResolvedValue(undefined);

      const result = await service.removeImage(actor, 'img-9');

      expect(!result.ok && result.status).toBe(HttpStatus.NOT_FOUND);
      expect(repository.deleteImage).not.toHaveBeenCalled();
    });

    it('answers 503 with the audit message when the transaction failed', async () => {
      repository.deleteImage.mockResolvedValue(null);

      const result = await service.removeImage(actor, 'img-1');

      expect(!result.ok && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });

  describe('listImages', () => {
    it('returns the mapped images', async () => {
      const result = await service.listImages(actor, PRODUCT);

      expect(result.ok && result.data[0]).toEqual(
        expect.objectContaining({ id: 'img-1', isPrimary: true }),
      );
    });

    it('answers 503 when the read failed', async () => {
      repository.listImages.mockResolvedValue(null);

      const result = await service.listImages(actor, PRODUCT);

      expect(!result.ok && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });
});
