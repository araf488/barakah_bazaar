import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  ErrorMessageTemplates,
  ErrorMessages,
  formatMessage,
} from '../../common/constants/error-messages.constants';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { CatalogConstants } from './catalog.constants';
import { CatalogMapper } from './catalog.mapper';
import { CatalogRepository } from './catalog.repository';
import {
  CategoryResponseDto,
  ProductDetailDto,
  ProductListItemDto,
} from './dto/catalog-response.dto';
import { ProductQueryDto } from './dto/product-query.dto';

/**
 * Read-side catalog business logic.
 *
 * Reference implementation for every other module: the service owns rules and
 * error mapping, the repository owns queries, the mapper owns the wire shape,
 * and nothing throws — failures come back as a `ServiceResponse` the
 * controller turns into an HTTP status.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly repository: CatalogRepository,
    @InjectPinoLogger(CatalogService.name) private readonly logger: PinoLogger,
  ) {}

  async getCategoryTree(): Promise<ServiceResponse<CategoryResponseDto[]>> {
    try {
      const categories = await this.repository.findActiveCategories();

      if (categories === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      return serviceOk(CatalogMapper.toCategoryTree(categories));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in CatalogService.getCategoryTree');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async listProducts(
    query: ProductQueryDto,
  ): Promise<ServiceResponse<PaginatedResponseDto<ProductListItemDto>>> {
    try {
      const term = query.search?.trim();

      // A search takes a different path entirely. Ranking lives in SQL, so the page is cut
      // from an ordered id list rather than from a Prisma orderBy that has no notion of
      // relevance — asking for "best match" and getting "newest" is worse than not offering it.
      if (term && term.length >= CatalogConstants.MinSearchTermLength) {
        return await this.searchProducts(term, query);
      }

      const page = await this.repository.findPublishedProducts(query);

      if (page === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      const items = page.items.map((product) => CatalogMapper.toProductListItem(product));
      return serviceOk(PaginatedResponseDto.of(items, page.total, query.page, query.limit));
    } catch (error) {
      this.logger.error(
        { err: error, categorySlug: query.categorySlug, page: query.page },
        'Exception occurred in CatalogService.listProducts',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * The ranked path: ids from SQL, rows from Prisma, order restored in memory.
   *
   * The re-sort is the load-bearing step. `WHERE id IN (...)` returns rows in whatever order
   * Postgres finds convenient, so hydrating without restoring the rank would silently discard
   * the ranking the search just computed.
   */
  private async searchProducts(
    term: string,
    query: ProductQueryDto,
  ): Promise<ServiceResponse<PaginatedResponseDto<ProductListItemDto>>> {
    const ranked = await this.repository.searchProductIds(term);

    if (ranked === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    const start = (query.page - 1) * query.limit;
    const pageIds = ranked.slice(start, start + query.limit);

    const products = await this.repository.findPublishedByIds(pageIds);

    if (products === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    const byId = new Map(products.map((product) => [product.id, product]));

    const items = pageIds
      .map((id) => byId.get(id))
      .filter((product): product is NonNullable<typeof product> => product !== undefined)
      .map((product) => CatalogMapper.toProductListItem(product));

    return serviceOk(PaginatedResponseDto.of(items, ranked.length, query.page, query.limit));
  }

  async getProductBySlug(slug: string): Promise<ServiceResponse<ProductDetailDto>> {
    try {
      const product = await this.repository.findPublishedProductBySlug(slug);

      if (product === null) {
        return serviceFail(
          HttpStatus.NOT_FOUND,
          formatMessage(ErrorMessageTemplates.NotFound, CatalogConstants.ProductResourceName),
        );
      }

      return serviceOk(CatalogMapper.toProductDetail(product));
    } catch (error) {
      this.logger.error(
        { err: error, slug },
        'Exception occurred in CatalogService.getProductBySlug',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }
}
