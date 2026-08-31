import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { GeoModule } from '../geo/geo.module';
import { AdminDeliveryService } from './admin-delivery.service';
import { DeliveryConstants } from './delivery.constants';
import { AdminDeliveryController, DeliveryController } from './delivery.controller';
import { DeliveryRepository } from './delivery.repository';
import { DeliveryService } from './delivery.service';

/**
 * Delivery pricing.
 *
 * Exports DeliveryService because checkout resolves the fee through it — the number must come
 * from one place, or the quote the customer saw and the amount they are charged will drift.
 */
@Module({
  imports: [AuthModule, GeoModule, AdminModule],
  controllers: [DeliveryController, AdminDeliveryController],
  providers: [DeliveryService, AdminDeliveryService, DeliveryRepository],
  exports: [DeliveryService],
})
export class DeliveryModule {
  /** Re-exported so consumers do not import the constants file directly. */
  static readonly constants = DeliveryConstants;
}
