import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { OrderStatus, Prisma, Review, ReviewStatus } from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** `undefined` means no such row; `null` means the query itself failed. */
export type ReviewResult = Review | null | undefined;

/** The order line a review hangs off, with only what the eligibility check needs. */
export type ReviewableLine = Prisma.OrderItemGetPayload<{
  select: {
    id: true;
    variantId: true;
    order: { select: { userId: true; status: true } };
    variant: { select: { productId: true } };
    review: { select: { id: true } };
  };
}>;

export interface CreateReviewData {
  productId: string;
  orderItemId: string;
  userId: string;
  rating: number;
  title: string | null;
  body: string | null;
}

export interface ReviewPage {
  items: Review[];
  total: number;
}

@Injectable()
export class ReviewRepository {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(ReviewRepository.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * The line being reviewed, with everything the eligibility check needs in one read.
   *
   * Ownership, delivery and prior-review are three separate refusals, and fetching them
   * together keeps the service from making three round trips to say no.
   */
  async findReviewableLine(orderItemId: string): Promise<ReviewableLine | null | undefined> {
    try {
      return (
        (await this.prisma.orderItem.findUnique({
          where: { id: orderItemId },
          select: {
            id: true,
            variantId: true,
            order: { select: { userId: true, status: true } },
            variant: { select: { productId: true } },
            review: { select: { id: true } },
          },
        })) ?? undefined
      );
    } catch (error) {
      this.logger.error(
        { err: error, orderItemId },
        'Exception occurred in ReviewRepository.findReviewableLine',
      );
      return null;
    }
  }

  async create(data: CreateReviewData): Promise<Review | null> {
    try {
      return await this.prisma.review.create({ data });
    } catch (error) {
      // A second review on the same line lands here on the unique index, which is what makes
      // "one review per delivered line" a guarantee rather than a check that can be raced.
      this.logger.error(
        { err: error, orderItemId: data.orderItemId },
        'Exception occurred in ReviewRepository.create',
      );
      return null;
    }
  }

  /**
   * Moderates a review and rebuilds the product's rating in one transaction.
   *
   * The rating is **recomputed from the published rows**, never incremented. An increment is
   * how a denormalised aggregate drifts: a publish that runs twice, or one that races a
   * rejection, leaves a number nothing can reproduce. A recount inside the same transaction
   * always agrees with the reviews it summarises.
   *
   * The `status: PENDING` filter is the concurrency guard — two moderators cannot both settle
   * the same review, and the loser writes nothing.
   */
  async moderateAndRecount(
    id: string,
    productId: string,
    status: ReviewStatus,
    moderatedBy: string,
    moderationNote: string | null,
  ): Promise<Review | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const affected = await tx.review.updateMany({
          where: { id, status: ReviewStatus.PENDING },
          data: { status, moderatedBy, moderatedAt: new Date(), moderationNote },
        });

        if (affected.count === 0) {
          throw new ReviewAlreadyModeratedError();
        }

        const totals = await tx.review.aggregate({
          where: { productId, status: ReviewStatus.PUBLISHED },
          _sum: { rating: true },
          _count: { _all: true },
        });

        await tx.product.update({
          where: { id: productId },
          data: {
            ratingSum: totals._sum.rating ?? 0,
            ratingCount: totals._count._all,
          },
        });

        return await tx.review.findUniqueOrThrow({ where: { id } });
      });
    } catch (error) {
      if (error instanceof ReviewAlreadyModeratedError) {
        this.logger.info({ reviewId: id }, 'Review was already moderated by someone else');
        return null;
      }

      this.logger.error(
        { err: error, reviewId: id },
        'Exception occurred in ReviewRepository.moderateAndRecount',
      );
      return null;
    }
  }

  async findById(id: string): Promise<ReviewResult> {
    try {
      return (await this.prisma.review.findUnique({ where: { id } })) ?? undefined;
    } catch (error) {
      this.logger.error(
        { err: error, reviewId: id },
        'Exception occurred in ReviewRepository.findById',
      );
      return null;
    }
  }

  /** Published reviews for one product, newest first. */
  async findPublishedForProduct(
    productId: string,
    skip: number,
    take: number,
  ): Promise<ReviewPage | null> {
    return this.page({ productId, status: ReviewStatus.PUBLISHED }, skip, take);
  }

  /** The moderation queue, or any status a staff member asks for. */
  async findForModeration(
    status: ReviewStatus | undefined,
    skip: number,
    take: number,
  ): Promise<ReviewPage | null> {
    return this.page(status ? { status } : {}, skip, take);
  }

  private async page(
    where: Prisma.ReviewWhereInput,
    skip: number,
    take: number,
  ): Promise<ReviewPage | null> {
    try {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.review.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
        this.prisma.review.count({ where }),
      ]);

      return { items, total };
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in ReviewRepository.page');
      return null;
    }
  }

  /** Exposed so the service can name the status a line must have reached. */
  static get reviewableOrderStatus(): OrderStatus {
    return OrderStatus.DELIVERED;
  }
}

/** Thrown inside the transaction to roll it back when a race lost. Never leaves this file. */
class ReviewAlreadyModeratedError extends Error {}
