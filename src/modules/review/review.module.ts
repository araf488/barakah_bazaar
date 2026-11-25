import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReviewConstants } from './review.constants';
import { AdminReviewController, ReviewController } from './review.controller';
import { ReviewRepository } from './review.repository';
import { ReviewService } from './review.service';

/**
 * Ratings and the moderation queue.
 *
 * No dependency on the order module: a review reaches its order line through Prisma's own
 * relation, so this module needs the schema rather than the other module's service.
 */
@Module({
  imports: [AuthModule],
  controllers: [ReviewController, AdminReviewController],
  providers: [ReviewService, ReviewRepository],
  exports: [ReviewService],
})
export class ReviewModule {
  /** Re-exported so consumers do not import the constants file directly. */
  static readonly constants = ReviewConstants;
}
