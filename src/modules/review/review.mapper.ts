import { Review } from '../../infra/prisma/prisma-client';
import { AdminReviewDto, AwaitingReviewDto, MyReviewDto, ReviewDto } from './dto/review.dto';
import { AwaitingLine, OwnReview } from './review.repository';

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

  /** The caller's own review: the public shape, its status, and the product to show it under. */
  toMineDto(row: OwnReview): MyReviewDto {
    return {
      ...ReviewMapper.toDto(row),
      status: row.status,
      productSlug: row.product.slug,
      productNameEn: row.product.nameEn,
      productNameBn: row.product.nameBn,
      imageUrl: row.product.images.at(0)?.url ?? null,
    };
  },

  toAwaitingDto(line: AwaitingLine): AwaitingReviewDto {
    const product = line.variant.product;
    return {
      orderItemId: line.id,
      productId: product.id,
      productSlug: product.slug,
      productNameEn: product.nameEn,
      productNameBn: product.nameBn,
      variantNameEn: line.variantNameEn,
      imageUrl: product.images.at(0)?.url ?? null,
      orderNumber: line.order.orderNumber,
      deliveredAt: line.order.deliveredAt ? line.order.deliveredAt.toISOString() : null,
    };
  },

  /** One line per product, keeping the first (the newest delivery, given the read's order). */
  toAwaitingList(lines: AwaitingLine[]): AwaitingReviewDto[] {
    const seen = new Set<string>();
    return lines
      .filter((line) => {
        const productId = line.variant.product.id;
        if (seen.has(productId)) {
          return false;
        }
        seen.add(productId);
        return true;
      })
      .map((line) => ReviewMapper.toAwaitingDto(line));
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
