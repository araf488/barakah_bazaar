import { Controller, Get, HttpStatus, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Public } from '../../common/decorators/public.decorator';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { unwrapOrThrow } from '../../common/types/service-response';
import { CatalogConstants } from './catalog.constants';
import { CatalogService } from './catalog.service';
import {
  CategoryResponseDto,
  ProductDetailDto,
  ProductListItemDto,
} from './dto/catalog-response.dto';
import { ProductQueryDto } from './dto/product-query.dto';

/**
 * Public catalog. Reachable without a token — browsing must work before
 * sign-in on the storefront and in the app.
 */
@ApiTags('Catalog')
@Controller(CatalogConstants.RouteBase)
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    @InjectPinoLogger(CatalogController.name) private readonly logger: PinoLogger,
  ) {}

  @Public()
  @Get('categories')
  @ApiOperation({ summary: 'Category tree' })
  @ApiResponse({ status: HttpStatus.OK, type: [CategoryResponseDto] })
  async getCategories(): Promise<CategoryResponseDto[]> {
    try {
      return unwrapOrThrow(await this.catalogService.getCategoryTree());
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in CatalogController.getCategories');
      throw error;
    }
  }

  @Public()
  @Get('products')
  @ApiOperation({ summary: 'List published products' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedResponseDto })
  async listProducts(
    @Query() query: ProductQueryDto,
  ): Promise<PaginatedResponseDto<ProductListItemDto>> {
    try {
      return unwrapOrThrow(await this.catalogService.listProducts(query));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in CatalogController.listProducts');
      throw error;
    }
  }

  @Public()
  @Get('products/:slug')
  @ApiOperation({ summary: 'Product detail by slug' })
  @ApiResponse({ status: HttpStatus.OK, type: ProductDetailDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  async getProduct(@Param('slug') slug: string): Promise<ProductDetailDto> {
    try {
      return unwrapOrThrow(await this.catalogService.getProductBySlug(slug));
    } catch (error) {
      this.logger.error({ err: error, slug }, 'Exception occurred in CatalogController.getProduct');
      throw error;
    }
  }
}
