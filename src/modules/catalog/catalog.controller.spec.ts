import { HttpException, HttpStatus } from '@nestjs/common';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { createMockLogger } from '../../../test/support/mocks';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { ProductListItemDto } from './dto/catalog-response.dto';
import { ProductQueryDto } from './dto/product-query.dto';

describe('CatalogController', () => {
  let catalogService: {
    getCategoryTree: jest.Mock;
    listProducts: jest.Mock;
    getProductBySlug: jest.Mock;
  };
  let controller: CatalogController;

  beforeEach(() => {
    catalogService = {
      getCategoryTree: jest.fn(),
      listProducts: jest.fn(),
      getProductBySlug: jest.fn(),
    };
    controller = new CatalogController(
      catalogService as unknown as CatalogService,
      createMockLogger(),
    );
  });

  describe('getCategories', () => {
    it('returns the tree on success', async () => {
      const tree = [
        { id: 'c1', slug: 'doi', nameEn: 'Doi', nameBn: 'দই', sortOrder: 0, children: [] },
      ];
      catalogService.getCategoryTree.mockResolvedValue({ ok: true, data: tree });

      await expect(controller.getCategories()).resolves.toEqual(tree);
    });

    it('translates a service failure into an HTTP error', async () => {
      catalogService.getCategoryTree.mockResolvedValue({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The service is temporarily unavailable. Please try again shortly.',
      });

      await expect(controller.getCategories()).rejects.toMatchObject({ status: 503 });
    });
  });

  describe('listProducts', () => {
    const emptyPage: PaginatedResponseDto<ProductListItemDto> = {
      items: [],
      meta: { page: 1, limit: 20, totalItems: 0, totalPages: 0, hasNextPage: false },
    };

    it('returns the page on success', async () => {
      catalogService.listProducts.mockResolvedValue({ ok: true, data: emptyPage });

      await expect(controller.listProducts(new ProductQueryDto())).resolves.toEqual(emptyPage);
    });

    it('passes the validated query to the service', async () => {
      catalogService.listProducts.mockResolvedValue({ ok: true, data: emptyPage });
      const query = Object.assign(new ProductQueryDto(), { categorySlug: 'doi' });

      await controller.listProducts(query);

      expect(catalogService.listProducts).toHaveBeenCalledWith(query);
    });

    it('translates a service failure into an HTTP error', async () => {
      catalogService.listProducts.mockResolvedValue({
        ok: false,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Something went wrong on our end. Please try again.',
      });

      await expect(controller.listProducts(new ProductQueryDto())).rejects.toThrow(HttpException);
    });
  });

  describe('getProduct', () => {
    it('returns the detail on success', async () => {
      catalogService.getProductBySlug.mockResolvedValue({ ok: true, data: { slug: 'doi-500g' } });

      await expect(controller.getProduct('doi-500g')).resolves.toEqual({ slug: 'doi-500g' });
    });

    it('passes the slug through', async () => {
      catalogService.getProductBySlug.mockResolvedValue({ ok: true, data: {} });

      await controller.getProduct('doi-500g');

      expect(catalogService.getProductBySlug).toHaveBeenCalledWith('doi-500g');
    });

    it('answers 404 for an unknown slug', async () => {
      catalogService.getProductBySlug.mockResolvedValue({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'Product was not found.',
      });

      await expect(controller.getProduct('missing')).rejects.toMatchObject({ status: 404 });
    });

    it('surfaces the not-found message the ticket contract specifies', async () => {
      catalogService.getProductBySlug.mockResolvedValue({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'Product was not found.',
      });

      await expect(controller.getProduct('missing')).rejects.toThrow('Product was not found.');
    });
  });
});
