import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Delete,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { unwrapOrThrow } from '../../common/types/service-response';
import { Category, Product, ProductVariant, UserRole } from '../../infra/prisma/prisma-client';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminImageService } from './admin-image.service';
import { AdminImportService } from './admin-import.service';
import {
  AddProductImageDto,
  ImageUploadUrlDto,
  ImageUploadUrlResponseDto,
  ProductImageDto,
  UpdateProductImageDto,
} from './dto/product-image.dto';
import { ImportProductsDto, ImportReportDto } from './dto/import.dto';
import { AdminConstants } from './admin.constants';
import {
  CreateCategoryDto,
  CreateProductDto,
  CreateVariantDto,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './dto/admin-catalog.dto';

/**
 * Catalog write-side.
 *
 * `SUPER_ADMIN` and `MARKETING` only. OPS and WAREHOUSE run orders and stock; neither has a
 * reason to rewrite a price, and a leaked token for either should not be able to. Every
 * route names its roles explicitly — a staff route with no `@Roles` is open to any signed-in
 * customer, so the omission is the dangerous case.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Roles(UserRole.SUPER_ADMIN, UserRole.MARKETING)
@Controller(`${AdminConstants.RouteBase}/catalog`)
export class AdminCatalogController {
  constructor(
    private readonly catalogService: AdminCatalogService,
    private readonly importService: AdminImportService,
    private readonly imageService: AdminImageService,
    @InjectPinoLogger(AdminCatalogController.name) private readonly logger: PinoLogger,
  ) {}

  @Post('categories')
  @ApiOperation({ summary: 'Create a category' })
  @ApiResponse({ status: HttpStatus.CREATED })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Slug already in use' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN })
  async createCategory(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: CreateCategoryDto,
  ): Promise<Category> {
    try {
      return unwrapOrThrow(
        await this.catalogService.createCategory(AdminCatalogController.require(user), dto),
      );
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in AdminCatalogController.createCategory',
      );
      throw error;
    }
  }

  @Patch('categories/:id')
  @ApiOperation({ summary: 'Edit a category' })
  @ApiResponse({ status: HttpStatus.OK })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Would create a cycle' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  async updateCategory(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<Category> {
    try {
      return unwrapOrThrow(
        await this.catalogService.updateCategory(AdminCatalogController.require(user), id, dto),
      );
    } catch (error) {
      this.logger.error(
        { err: error, categoryId: id },
        'Exception occurred in AdminCatalogController.updateCategory',
      );
      throw error;
    }
  }

  @Patch('categories/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hide a category from the storefront' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Still holds live products' })
  async deactivateCategory(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Category> {
    try {
      return unwrapOrThrow(
        await this.catalogService.deactivateCategory(AdminCatalogController.require(user), id),
      );
    } catch (error) {
      this.logger.error(
        { err: error, categoryId: id },
        'Exception occurred in AdminCatalogController.deactivateCategory',
      );
      throw error;
    }
  }

  @Post('products')
  @ApiOperation({ summary: 'Create a product (unpublished)' })
  @ApiResponse({ status: HttpStatus.CREATED })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Slug already in use' })
  async createProduct(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: CreateProductDto,
  ): Promise<Product> {
    try {
      return unwrapOrThrow(
        await this.catalogService.createProduct(AdminCatalogController.require(user), dto),
      );
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in AdminCatalogController.createProduct',
      );
      throw error;
    }
  }

  @Patch('products/:id')
  @ApiOperation({ summary: 'Edit a product' })
  @ApiResponse({ status: HttpStatus.OK })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  async updateProduct(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<Product> {
    try {
      return unwrapOrThrow(
        await this.catalogService.updateProduct(AdminCatalogController.require(user), id, dto),
      );
    } catch (error) {
      this.logger.error(
        { err: error, productId: id },
        'Exception occurred in AdminCatalogController.updateProduct',
      );
      throw error;
    }
  }

  @Patch('products/:id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish a product to the storefront' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'No active variant to sell' })
  async publishProduct(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Product> {
    try {
      return unwrapOrThrow(
        await this.catalogService.publishProduct(AdminCatalogController.require(user), id),
      );
    } catch (error) {
      this.logger.error(
        { err: error, productId: id },
        'Exception occurred in AdminCatalogController.publishProduct',
      );
      throw error;
    }
  }

  @Patch('products/:id/unpublish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hide a product from the storefront' })
  async unpublishProduct(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Product> {
    try {
      return unwrapOrThrow(
        await this.catalogService.unpublishProduct(AdminCatalogController.require(user), id),
      );
    } catch (error) {
      this.logger.error(
        { err: error, productId: id },
        'Exception occurred in AdminCatalogController.unpublishProduct',
      );
      throw error;
    }
  }

  @Post('products/:id/variants')
  @ApiOperation({ summary: 'Add a sellable variant' })
  @ApiResponse({ status: HttpStatus.CREATED })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'SKU already in use' })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Weight or compare-at price invalid',
  })
  async createVariant(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateVariantDto,
  ): Promise<ProductVariant> {
    try {
      return unwrapOrThrow(
        await this.catalogService.createVariant(AdminCatalogController.require(user), id, dto),
      );
    } catch (error) {
      this.logger.error(
        { err: error, productId: id },
        'Exception occurred in AdminCatalogController.createVariant',
      );
      throw error;
    }
  }

  @Patch('variants/:id')
  @ApiOperation({ summary: 'Edit a variant, including its price' })
  @ApiResponse({ status: HttpStatus.OK })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  async updateVariant(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVariantDto,
  ): Promise<ProductVariant> {
    try {
      return unwrapOrThrow(
        await this.catalogService.updateVariant(AdminCatalogController.require(user), id, dto),
      );
    } catch (error) {
      this.logger.error(
        { err: error, variantId: id },
        'Exception occurred in AdminCatalogController.updateVariant',
      );
      throw error;
    }
  }

  /**
   * Bulk product import.
   *
   * Create-only and all-or-nothing: every row must validate before anything is written, and
   * an existing slug is an error rather than an update. Send `dryRun` first — the report
   * lists every problem with its line and column, so a buyer can fix the spreadsheet in one
   * pass instead of discovering faults one upload at a time.
   *
   * Answers 200 even when rows were rejected: the body IS the report, and a 4xx would make
   * the admin portal treat a perfectly useful validation result as a failure.
   */
  @Post('import')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk-import products from CSV' })
  @ApiResponse({ status: HttpStatus.OK, type: ImportReportDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Empty or oversized file' })
  async importProducts(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: ImportProductsDto,
  ): Promise<ImportReportDto> {
    try {
      return unwrapOrThrow(
        await this.importService.importProducts(AdminCatalogController.require(user), dto),
      );
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in AdminCatalogController.importProducts',
      );
      throw error;
    }
  }

  // ── Images ────────────────────────────────────────────────────────────────

  /**
   * Mints a signed URL the client PUTs the file to directly.
   *
   * Files never stream through this API — a 5 MB upload has no business occupying a Node
   * process. The returned `objectPath` is what gets registered afterwards; the client never
   * chooses it, and never supplies a URL.
   */
  @Post('products/:id/images/upload-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a signed URL for a product image upload' })
  @ApiResponse({ status: HttpStatus.OK, type: ImageUploadUrlResponseDto })
  @ApiResponse({ status: HttpStatus.SERVICE_UNAVAILABLE, description: 'Storage not configured' })
  async createImageUploadUrl(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImageUploadUrlDto,
  ): Promise<ImageUploadUrlResponseDto> {
    try {
      return unwrapOrThrow(
        await this.imageService.createUploadUrl(AdminCatalogController.require(user), id, dto),
      );
    } catch (error) {
      this.logger.error(
        { err: error, productId: id },
        'Exception occurred in AdminCatalogController.createImageUploadUrl',
      );
      throw error;
    }
  }

  @Post('products/:id/images')
  @ApiOperation({ summary: 'Register an uploaded image against a product' })
  @ApiResponse({ status: HttpStatus.CREATED, type: ProductImageDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "Object path is not this product's" })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Image limit reached' })
  async addImage(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddProductImageDto,
  ): Promise<ProductImageDto> {
    try {
      return unwrapOrThrow(
        await this.imageService.addImage(AdminCatalogController.require(user), id, dto),
      );
    } catch (error) {
      this.logger.error(
        { err: error, productId: id },
        'Exception occurred in AdminCatalogController.addImage',
      );
      throw error;
    }
  }

  @Get('products/:id/images')
  @ApiOperation({ summary: "A product's images, primary first" })
  @ApiResponse({ status: HttpStatus.OK, type: [ProductImageDto] })
  async listImages(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProductImageDto[]> {
    try {
      return unwrapOrThrow(
        await this.imageService.listImages(AdminCatalogController.require(user), id),
      );
    } catch (error) {
      this.logger.error(
        { err: error, productId: id },
        'Exception occurred in AdminCatalogController.listImages',
      );
      throw error;
    }
  }

  @Patch('images/:id')
  @ApiOperation({ summary: 'Edit alt text or sort order' })
  @ApiResponse({ status: HttpStatus.OK, type: ProductImageDto })
  async updateImage(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductImageDto,
  ): Promise<ProductImageDto> {
    try {
      return unwrapOrThrow(
        await this.imageService.updateImage(AdminCatalogController.require(user), id, dto),
      );
    } catch (error) {
      this.logger.error(
        { err: error, imageId: id },
        'Exception occurred in AdminCatalogController.updateImage',
      );
      throw error;
    }
  }

  @Patch('images/:id/primary')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Make this the product tile image' })
  @ApiResponse({ status: HttpStatus.OK, type: ProductImageDto })
  async setPrimaryImage(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProductImageDto> {
    try {
      return unwrapOrThrow(
        await this.imageService.setPrimary(AdminCatalogController.require(user), id),
      );
    } catch (error) {
      this.logger.error(
        { err: error, imageId: id },
        'Exception occurred in AdminCatalogController.setPrimaryImage',
      );
      throw error;
    }
  }

  @Delete('images/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an image; the next one becomes primary' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  async removeImage(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    try {
      unwrapOrThrow(await this.imageService.removeImage(AdminCatalogController.require(user), id));
    } catch (error) {
      this.logger.error(
        { err: error, imageId: id },
        'Exception occurred in AdminCatalogController.removeImage',
      );
      throw error;
    }
  }

  /** Guard-order safety net; none of these routes are `@Public()`. */
  private static require(user: AuthenticatedUser | undefined): AuthenticatedUser {
    if (!user) {
      throw new UnauthorizedException(ErrorMessages.MissingAccessToken);
    }
    return user;
  }
}
