import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CartModule } from '../cart/cart.module';
import { InventoryModule } from '../inventory/inventory.module';
import { UserModule } from '../user/user.module';
import { AdminOrderController } from './admin-order.controller';
import { OrderController } from './order.controller';
import { OrderRepository } from './order.repository';
import { NotificationModule } from '../notification/notification.module';
import { CheckoutSources } from './checkout-sources';
import { OrderService } from './order.service';
import { ReservationSweeper } from './reservation-sweeper.service';

/**
 * Checkout and order lifecycle.
 *
 * Depends on cart, address and inventory because checkout is where all three are re-proven:
 * the basket re-priced, the address re-proved to be the caller's, and stock re-checked before
 * anything is written.
 */
@Module({
  imports: [AuthModule, CartModule, UserModule, InventoryModule, NotificationModule],
  controllers: [OrderController, AdminOrderController],
  providers: [OrderService, OrderRepository, CheckoutSources, ReservationSweeper],
  exports: [OrderService],
})
export class OrderModule {}
