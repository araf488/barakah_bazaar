import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AdminCatalogController } from './admin-catalog.controller';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminImageService } from './admin-image.service';
import { AdminImportService } from './admin-import.service';
import { CreateCategoryDto, CreateProductDto, CreateVariantDto } from './dto/admin-catalog.dto';

const staff: AuthenticatedUser = {
  userId: '11111111-1111-1111-1111-111111111111',
  sessionId: 'session-1',
  email: 'test@example.com',
  role: UserRole.MARKETING,
};

const validCategory = { slug: 'dry-fruits', nameEn: 'Dry Fruits', nameBn: 'শুকনো ফল' };
const validVariant = {
  sku: 'ALM-500',
  nameEn: '500g',
  nameBn: '৫০০ গ্রাম',
  pricePoysha: 125000,
  unitLabel: '500g',
};

describe('AdminCatalogController', () => {
  let catalogService: Record<string, jest.Mock>;
  let importService: { importProducts: jest.Mock };
  let imageService: Record<string, jest.Mock>;
  let controller: AdminCatalogController;

  beforeEach(() => {
    catalogService = {
      createCategory: jest.fn().mockResolvedValue({ ok: true, data: { id: 'cat-1' } }),
      updateCategory: jest.fn().mockResolvedValue({ ok: true, data: { id: 'cat-1' } }),
      deactivateCategory: jest.fn().mockResolvedValue({ ok: true, data: { id: 'cat-1' } }),
      createProduct: jest.fn().mockResolvedValue({ ok: true, data: { id: 'prod-1' } }),
      updateProduct: jest.fn().mockResolvedValue({ ok: true, data: { id: 'prod-1' } }),
      publishProduct: jest.fn().mockResolvedValue({ ok: true, data: { id: 'prod-1' } }),
      unpublishProduct: jest.fn().mockResolvedValue({ ok: true, data: { id: 'prod-1' } }),
      createVariant: jest.fn().mockResolvedValue({ ok: true, data: { id: 'var-1' } }),
      updateVariant: jest.fn().mockResolvedValue({ ok: true, data: { id: 'var-1' } }),
    };
    importService = { importProducts: jest.fn() };
    imageService = {
      createUploadUrl: jest.fn().mockResolvedValue({ ok: true, data: { objectPath: 'p' } }),
      addImage: jest.fn().mockResolvedValue({ ok: true, data: { id: 'img-1' } }),
      listImages: jest.fn().mockResolvedValue({ ok: true, data: [] }),
      updateImage: jest.fn().mockResolvedValue({ ok: true, data: { id: 'img-1' } }),
      setPrimary: jest.fn().mockResolvedValue({ ok: true, data: { id: 'img-1' } }),
      removeImage: jest.fn().mockResolvedValue({ ok: true, data: undefined }),
    };
    controller = new AdminCatalogController(
      catalogService as unknown as AdminCatalogService,
      importService as unknown as AdminImportService,
      imageService as unknown as AdminImageService,
      createMockLogger(),
    );
  });

  describe('routing', () => {
    it('creates a category and passes the verified caller through', async () => {
      const dto = Object.assign(new CreateCategoryDto(), validCategory);

      await expect(controller.createCategory(staff, dto)).resolves.toEqual({ id: 'cat-1' });
      expect(catalogService.createCategory).toHaveBeenCalledWith(staff, dto);
    });

    it('refuses every route with no verified caller', async () => {
      const dto = Object.assign(new CreateCategoryDto(), validCategory);

      await expect(controller.createCategory(undefined, dto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(catalogService.createCategory).not.toHaveBeenCalled();
    });

    it('surfaces the no-variant conflict when publishing', async () => {
      catalogService.publishProduct.mockResolvedValue({
        ok: false,
        status: HttpStatus.CONFLICT,
        message:
          'A product needs at least one active variant with a price before it can be published.',
      });

      await expect(controller.publishProduct(staff, 'prod-1')).rejects.toThrow(
        'A product needs at least one active variant with a price before it can be published.',
      );
    });

    it('surfaces a slug conflict as an HTTP error', async () => {
      catalogService.createProduct.mockResolvedValue({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'The slug "premium-almonds" is already in use. Slugs must be unique.',
      });
      const dto = Object.assign(new CreateProductDto(), {
        slug: 'premium-almonds',
        nameEn: 'x',
        nameBn: 'x',
        categoryId: 'cat-1',
      });

      await expect(controller.createProduct(staff, dto)).rejects.toThrow(HttpException);
    });

    it('passes the variant payload to the right product', async () => {
      const dto = Object.assign(new CreateVariantDto(), validVariant);

      await controller.createVariant(staff, 'prod-1', dto);

      expect(catalogService.createVariant).toHaveBeenCalledWith(staff, 'prod-1', dto);
    });
  });

  describe('CreateCategoryDto validation', () => {
    it('accepts a well-formed category', async () => {
      await expect(validate(plainToInstance(CreateCategoryDto, validCategory))).resolves.toEqual(
        [],
      );
    });

    it.each([
      ['uppercase', 'Dry-Fruits'],
      ['spaces', 'dry fruits'],
      ['a leading hyphen', '-dry-fruits'],
      ['a double hyphen', 'dry--fruits'],
      ['underscores', 'dry_fruits'],
    ])('rejects a slug with %s', async (_label, slug) => {
      // The storefront routes on this, so a malformed slug is a broken URL.
      const errors = await validate(plainToInstance(CreateCategoryDto, { ...validCategory, slug }));

      expect(errors).not.toEqual([]);
    });

    it('requires both languages', async () => {
      const errors = await validate(
        plainToInstance(CreateCategoryDto, { slug: 'dry-fruits', nameEn: 'Dry Fruits' }),
      );

      expect(errors.map((error) => error.property)).toContain('nameBn');
    });
  });

  describe('CreateVariantDto validation', () => {
    it('accepts a well-formed variant', async () => {
      await expect(validate(plainToInstance(CreateVariantDto, validVariant))).resolves.toEqual([]);
    });

    it('rejects a fractional price — poysha is an integer', async () => {
      const errors = await validate(
        plainToInstance(CreateVariantDto, { ...validVariant, pricePoysha: 1250.5 }),
      );

      expect(errors[0].constraints?.isInt).toBe('pricePoysha must be a whole number of poysha');
    });

    it.each([
      ['zero', 0],
      ['negative', -100],
    ])('rejects a %s price', async (_label, pricePoysha) => {
      const errors = await validate(
        plainToInstance(CreateVariantDto, { ...validVariant, pricePoysha }),
      );

      expect(errors).not.toEqual([]);
    });

    it('rejects an implausibly large price, which is usually taka entered as poysha', async () => {
      const errors = await validate(
        plainToInstance(CreateVariantDto, { ...validVariant, pricePoysha: 999_000_000 }),
      );

      expect(errors).not.toEqual([]);
    });

    it('requires a unit label the customer can read', async () => {
      const payload: Record<string, unknown> = { ...validVariant };
      delete payload.unitLabel;

      const errors = await validate(plainToInstance(CreateVariantDto, payload));

      expect(errors.map((error) => error.property)).toContain('unitLabel');
    });
  });
});
