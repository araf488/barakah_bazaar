import { Review } from '../../infra/prisma/prisma-client';
import { AdminReviewDto, ReviewDto } from './dto/review.dto';

export const ReviewMapper = {
  /**
   * The public shape.
   *
   * `isVerifiedPurchase` is hardcoded true rather than stored, because the schema makes it
   * true: a review exists only against a delivered order line. A column would be a second
   * source of truth that could disagree with the foreign key.
   */
  toDto(row: Review): ReviewDto {
    return {
      id: row.id,
      productId: row.productId,
      rating: row.rating,
      title: row.title,
      body: row.body,
      isVerifiedPurchase: true,
      createdAt: row.createdAt.toISOString(),
    };
  },

  toAdminDto(row: Review): AdminReviewDto {
    return {
      ...ReviewMapper.toDto(row),
      status: row.status,
      userId: row.userId,
      moderatedBy: row.moderatedBy,
      moderatedAt: row.moderatedAt ? row.moderatedAt.toISOString() : null,
      moderationNote: row.moderationNote,
    };
  },
} as const;
