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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { unwrapOrThrow } from '../../common/types/service-response';
import { UserRole } from '../../infra/prisma/prisma-client';
import { AuthService } from '../auth/auth.service';
import { AdminPromotionService } from './admin-promotion.service';
import { PromotionConstants } from './promotion.constants';
import { PromotionMapper } from './promotion.mapper';
import { PromotionService } from './promotion.service';
import {
  PreviewPromotionDto,
  PromotionDto,
  PromotionListDto,
  PromotionPreviewDto,
  UpsertPromotionDto,
} from './dto/promotion.dto';

/**
 * Checking a promo code before checkout.
 *
 * Advisory only: checkout re-applies the code server-side against the real basket. This
 * exists so the storefront can show a saving before the customer commits, not so the client
 * can tell the server what to deduct.
 *
 * It is authenticated because the per-customer limit is part of the answer — an anonymous
 * preview could not say whether *this* customer has already used the code.
 */
@ApiTags('Promotions')
@ApiBearerAuth()
@Controller(PromotionConstants.RouteBase)
export class PromotionController {
  constructor(
    private readonly promotions: PromotionService,
    private readonly authService: AuthService,
    @InjectPinoLogger(PromotionController.name) private readonly logger: PinoLogger,
  ) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'What a promo code would save on this basket' })
  @ApiResponse({ status: HttpStatus.OK, type: PromotionPreviewDto })
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PreviewPromotionDto,
  ): Promise<PromotionPreviewDto> {
    try {
      const owner = unwrapOrThrow(await this.authService.resolveActiveUserId(user));

      const applied = unwrapOrThrow(
        await this.promotions.apply(dto.code, {
          subtotalPoysha: BigInt(dto.subtotalPoysha),
          deliveryFeePoysha: BigInt(dto.deliveryFeePoysha ?? 0),
          userId: owner,
        }),
      );

      return PromotionMapper.toPreview(applied.promotion, applied.discountPoysha);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in PromotionController.preview');
      throw error;
    }
  }
}

/**
 * Promo code management.
 *
 * `SUPER_ADMIN` and `MARKETING`: campaigns are marketing's job, and this is the first surface
 * that role owns. OPS runs orders and WAREHOUSE moves stock; neither sets what the business
 * gives away.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Roles(UserRole.SUPER_ADMIN, UserRole.MARKETING)
@Controller(PromotionConstants.AdminRouteBase)
export class AdminPromotionController {
  constructor(
    private readonly promotions: AdminPromotionService,
    @InjectPinoLogger(AdminPromotionController.name) private readonly logger: PinoLogger,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Promo codes, newest first' })
  @ApiResponse({ status: HttpStatus.OK, type: PromotionListDto })
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<PromotionListDto> {
    try {
      return unwrapOrThrow(
        await this.promotions.list(
          Number(page) || 1,
          Number(pageSize) || PromotionConstants.DefaultPageSize,
        ),
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AdminPromotionController.list');
      throw error;
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create a promo code' })
  @ApiResponse({ status: HttpStatus.CREATED, type: PromotionDto })
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UpsertPromotionDto,
  ): Promise<PromotionDto> {
    try {
      return unwrapOrThrow(await this.promotions.create(actor, dto));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AdminPromotionController.create');
      throw error;
    }
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a promo code' })
  @ApiResponse({ status: HttpStatus.OK, type: PromotionDto })
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertPromotionDto,
  ): Promise<PromotionDto> {
    try {
      return unwrapOrThrow(await this.promotions.update(actor, id, dto));
    } catch (error) {
      this.logger.error(
        { err: error, promotionId: id },
        'Exception occurred in AdminPromotionController.update',
      );
      throw error;
    }
  }
}
