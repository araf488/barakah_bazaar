import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { ReviewConstants } from './review.constants';
import { ReviewService } from './review.service';
import {
  AdminReviewDto,
  AdminReviewListDto,
  CreateReviewDto,
  ModerateReviewDto,
  ReviewDto,
  ReviewListDto,
  ReviewQueryDto,
} from './dto/review.dto';

/**
 * Customer-facing reviews.
 *
 * Reading published reviews needs no role. Writing one needs a delivered order line the caller
 * owns, which the service proves — there is no product id in the create payload at all, so a
 * review cannot be aimed at a product the customer never bought.
 */
@ApiTags('Reviews')
@ApiBearerAuth()
@Controller(ReviewConstants.RouteBase)
export class ReviewController {
  constructor(
    private readonly reviews: ReviewService,
    @InjectPinoLogger(ReviewController.name) private readonly logger: PinoLogger,
  ) {}

  @Get('product/:productId')
  @ApiOperation({ summary: 'Published reviews for a product, newest first' })
  @ApiResponse({ status: HttpStatus.OK, type: ReviewListDto })
  async listForProduct(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: ReviewQueryDto,
  ): Promise<ReviewListDto> {
    try {
      return unwrapOrThrow(await this.reviews.listForProduct(productId, query));
    } catch (error) {
      this.logger.error(
        { err: error, productId },
        'Exception occurred in ReviewController.listForProduct',
      );
      throw error;
    }
  }

  @Post()
  @ApiOperation({ summary: 'Review a delivered order line' })
  @ApiResponse({ status: HttpStatus.CREATED, type: ReviewDto })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReviewDto,
  ): Promise<ReviewDto> {
    try {
      return unwrapOrThrow(await this.reviews.create(user, dto));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in ReviewController.create');
      throw error;
    }
  }
}

/**
 * The moderation queue.
 *
 * `SUPER_ADMIN` and `MARKETING`: reviews are storefront content, which is marketing's remit.
 * OPS runs orders and WAREHOUSE moves stock; neither decides what customers read.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Roles(UserRole.SUPER_ADMIN, UserRole.MARKETING)
@Controller(ReviewConstants.AdminRouteBase)
export class AdminReviewController {
  constructor(
    private readonly reviews: ReviewService,
    @InjectPinoLogger(AdminReviewController.name) private readonly logger: PinoLogger,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Reviews awaiting moderation, or any status' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminReviewListDto })
  async list(@Query() query: ReviewQueryDto): Promise<AdminReviewListDto> {
    try {
      return unwrapOrThrow(await this.reviews.listForModeration(query));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AdminReviewController.list');
      throw error;
    }
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish a review and rebuild the product rating' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminReviewDto })
  async publish(
    @CurrentUser() staff: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerateReviewDto,
  ): Promise<AdminReviewDto> {
    try {
      return unwrapOrThrow(await this.reviews.publish(staff, id, dto));
    } catch (error) {
      this.logger.error(
        { err: error, reviewId: id },
        'Exception occurred in AdminReviewController.publish',
      );
      throw error;
    }
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a review' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminReviewDto })
  async reject(
    @CurrentUser() staff: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerateReviewDto,
  ): Promise<AdminReviewDto> {
    try {
      return unwrapOrThrow(await this.reviews.reject(staff, id, dto));
    } catch (error) {
      this.logger.error(
        { err: error, reviewId: id },
        'Exception occurred in AdminReviewController.reject',
      );
      throw error;
    }
  }
}
