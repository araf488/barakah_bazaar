import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { AdminPromotionService } from './admin-promotion.service';
import { PromotionConstants } from './promotion.constants';
import { AdminPromotionController, PromotionController } from './promotion.controller';
import { PromotionRepository } from './promotion.repository';
import { PromotionService } from './promotion.service';

/**
 * Promo codes.
 *
 * Exports PromotionService because checkout prices the discount through it — the amount must
 * come from one place, or the saving the customer previewed and the one they receive drift.
 */
@Module({
  imports: [AuthModule, AdminModule],
  controllers: [PromotionController, AdminPromotionController],
  providers: [PromotionService, AdminPromotionService, PromotionRepository],
  exports: [PromotionService],
})
export class PromotionModule {
  /** Re-exported so consumers do not import the constants file directly. */
  static readonly constants = PromotionConstants;
}
