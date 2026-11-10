import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../../config';
import { PaymentGateway } from '../ports/payment-gateway.port';
import { BkashPaymentGateway } from './bkash-payment.gateway';
import { NoopPaymentGateway } from './noop-payment.gateway';

/**
 * Chooses the payment adapter from `PAYMENT_PROVIDER`.
 *
 * `noop` is the default and refuses every charge, so a fresh clone is fail-closed. `bkash`
 * builds the Tokenized Checkout adapter; boot validation has already insisted on its five
 * credentials in a deployed environment.
 */
export const createPaymentGateway = (
  config: AppConfigService,
  logger: PinoLogger,
): PaymentGateway => {
  const provider = config.get('PAYMENT_PROVIDER', { infer: true });

  if (provider === 'bkash') {
    return new BkashPaymentGateway(config, logger);
  }

  return new NoopPaymentGateway(logger);
};
