import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  ErrorMessageTemplates,
  ErrorMessages,
  formatMessage,
} from '../../common/constants/error-messages.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { OrderStatus, Review, ReviewStatus } from '../../infra/prisma/prisma-client';
import { AuthService } from '../auth/auth.service';
import { ReviewConstants, ReviewMessages } from './review.constants';
import { ReviewMapper } from './review.mapper';
import { ReviewableLine, ReviewRepository } from './review.repository';
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
 * Ratings on things customers actually received.
 *
 * "Verified purchase" is a property of the schema here, not a badge the application remembers
 * to award: a review hangs off an ORDER LINE with a unique index, so a product nobody bought
 * cannot be reviewed and a line cannot be reviewed twice.
 *
 * Nothing is public until a staff member publishes it. For a halal grocery an unmoderated
 * claim about a product's provenance, or a food-safety complaint, appearing unread on the
 * storefront is a trust and liability question rather than a spam one.
 */
@Injectable()
export class ReviewService {
  constructor(
    private readonly repository: ReviewRepository,
    private readonly authService: AuthService,
    @InjectPinoLogger(ReviewService.name) private readonly logger: PinoLogger,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateReviewDto): Promise<ServiceResponse<ReviewDto>> {
    try {
      const owner = await this.authService.resolveActiveUserId(user);
      if (!owner.ok) {
        return owner;
      }

      const line = await this.repository.findReviewableLine(dto.orderItemId);

      if (line === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ReviewMessages.Unavailable);
      }

      const guard = ReviewService.assertReviewable(line, owner.data);
      if (guard) {
        return guard;
      }

      const created = await this.repository.create({
        productId: (line as ReviewableLine).variant.productId,
        orderItemId: dto.orderItemId,
        userId: owner.data,
        rating: dto.rating,
        title: dto.title ?? null,
        body: dto.body ?? null,
      });

      if (!created) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ReviewMessages.Unavailable);
      }

      // Returned to its author, who may see their own review before it is public. Nobody
      // else can: the product listing only returns PUBLISHED rows.
      return serviceOk(ReviewMapper.toDto(created));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in ReviewService.create');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** Published reviews for one product. */
  async listForProduct(
    productId: string,
    query: ReviewQueryDto,
  ): Promise<ServiceResponse<ReviewListDto>> {
    try {
      const take = query.pageSize ?? ReviewConstants.DefaultPageSize;
      const page = query.page ?? 1;

      const result = await this.repository.findPublishedForProduct(
        productId,
        (page - 1) * take,
        take,
      );

      if (result === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ReviewMessages.Unavailable);
      }

      return serviceOk({
        items: result.items.map((row) => ReviewMapper.toDto(row)),
        total: result.total,
        page,
        pageSize: take,
      });
    } catch (error) {
      this.logger.error(
        { err: error, productId },
        'Exception occurred in ReviewService.listForProduct',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** The moderation queue. */
  async listForModeration(query: ReviewQueryDto): Promise<ServiceResponse<AdminReviewListDto>> {
    try {
      const take = query.pageSize ?? ReviewConstants.DefaultPageSize;
      const page = query.page ?? 1;

      const result = await this.repository.findForModeration(query.status, (page - 1) * take, take);

      if (result === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ReviewMessages.Unavailable);
      }

      return serviceOk({
        items: result.items.map((row) => ReviewMapper.toAdminDto(row)),
        total: result.total,
        page,
        pageSize: take,
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in ReviewService.listForModeration');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async publish(
    staff: AuthenticatedUser,
    id: string,
    dto: ModerateReviewDto,
  ): Promise<ServiceResponse<AdminReviewDto>> {
    return this.moderate(staff, id, ReviewStatus.PUBLISHED, dto);
  }

  async reject(
    staff: AuthenticatedUser,
    id: string,
    dto: ModerateReviewDto,
  ): Promise<ServiceResponse<AdminReviewDto>> {
    return this.moderate(staff, id, ReviewStatus.REJECTED, dto);
  }

  /** Both moderation outcomes, since only the status differs. */
  private async moderate(
    staff: AuthenticatedUser,
    id: string,
    status: ReviewStatus,
    dto: ModerateReviewDto,
  ): Promise<ServiceResponse<AdminReviewDto>> {
    try {
      const actor = await this.authService.resolveActiveUserId(staff);
      if (!actor.ok) {
        return actor;
      }

      const existing = await this.repository.findById(id);

      if (existing === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ReviewMessages.Unavailable);
      }

      if (existing === undefined) {
        return serviceFail(
          HttpStatus.NOT_FOUND,
          formatMessage(ErrorMessageTemplates.NotFound, ReviewConstants.ResourceName),
        );
      }

      if (existing.status !== ReviewStatus.PENDING) {
        return serviceFail(HttpStatus.CONFLICT, ReviewMessages.NotPending);
      }

      const moderated = await this.repository.moderateAndRecount(
        id,
        existing.productId,
        status,
        actor.data,
        dto.note ?? null,
      );

      if (!moderated) {
        // Either someone else moderated it first, or the recount failed and took the whole
        // transaction with it. Both mean this caller changed nothing.
        return serviceFail(HttpStatus.CONFLICT, ReviewMessages.NotPending);
      }

      return serviceOk(ReviewMapper.toAdminDto(moderated));
    } catch (error) {
      this.logger.error(
        { err: error, reviewId: id },
        'Exception occurred in ReviewService.moderate',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Every reason a line cannot be reviewed.
   *
   * A line belonging to someone else answers the same as one that does not exist, so the
   * endpoint cannot be used to probe other customers' orders.
   */
  private static assertReviewable(
    line: ReviewableLine | undefined,
    userId: string,
  ): ServiceResponse<never> | null {
    if (!line || line.order.userId !== userId) {
      return serviceFail(HttpStatus.NOT_FOUND, ReviewMessages.LineNotFound);
    }

    if (line.order.status !== OrderStatus.DELIVERED) {
      return serviceFail(HttpStatus.CONFLICT, ReviewMessages.NotDelivered);
    }

    if (line.review) {
      return serviceFail(HttpStatus.CONFLICT, ReviewMessages.AlreadyReviewed);
    }

    return null;
  }

  /** Exposed so the catalog mapper and this module agree on what an unrated product shows. */
  static averageOf(review: Pick<Review, 'rating'>[]): number {
    if (review.length === 0) {
      return 0;
    }

    return review.reduce((total, row) => total + row.rating, 0) / review.length;
  }
}
