import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../../config';
import { PaymentGateway } from '../ports/payment-gateway.port';
import { NoopPaymentGateway } from './noop-payment.gateway';

/**
 * Chooses the payment adapter from `PAYMENT_PROVIDER`.
 *
 * There is no "unavailable" variant here, unlike SMS and email: `NoopPaymentGateway` already
 * refuses every charge, so an unimplemented provider falling back to it is already fail-closed.
 * The error log is what tells the operator their setting did nothing.
 */
export const createPaymentGateway = (
  config: AppConfigService,
  logger: PinoLogger,
): PaymentGateway => {
  const provider = config.get('PAYMENT_PROVIDER', { infer: true });

  if (provider !== 'noop') {
    // bkash is in the enum as the documented roadmap and has no adapter yet. Loud, because an
    // operator who set this believes the shop can take online payments.
    logger.error(
      { provider },
      'PAYMENT_PROVIDER names a gateway this build has no adapter for; charges will be refused',
    );
  }

  return new NoopPaymentGateway(logger);
};
