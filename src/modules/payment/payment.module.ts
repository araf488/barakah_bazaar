import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrderRepository } from '../order/order.repository';
import { AdminPaymentController } from './admin-payment.controller';
import { NoopPaymentGateway } from './gateways/noop-payment.gateway';
import { PaymentConstants, PaymentTokens } from './payment.constants';
import { PaymentRepository } from './payment.repository';
import { PaymentService } from './payment.service';

/**
 * The money ledger.
 *
 * The gateway defaults to NoopPaymentGateway, which **refuses** every charge rather than
 * reporting success. Cash on delivery is unaffected — it never goes through a gateway — so a
 * fresh clone with no merchant account can still take, record and refund real orders.
 *
 * OrderRepository is provided directly rather than by importing OrderModule, for the same
 * reason as NotificationModule: the order module will eventually read payment state, and
 * importing it back would be a cycle.
 */
@Module({
  imports: [AuthModule],
  controllers: [AdminPaymentController],
  providers: [
    PaymentService,
    PaymentRepository,
    OrderRepository,
    { provide: PaymentTokens.PaymentGateway, useClass: NoopPaymentGateway },
  ],
  exports: [PaymentService],
})
export class PaymentModule {
  /** Re-exported so consumers do not import the constants file directly. */
  static readonly constants = PaymentConstants;
}
