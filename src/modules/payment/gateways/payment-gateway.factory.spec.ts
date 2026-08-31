import { PinoLogger } from 'nestjs-pino';
import { createMockConfig, createMockLogger } from '../../../../test/support/mocks';
import { NoopPaymentGateway } from './noop-payment.gateway';
import { createPaymentGateway } from './payment-gateway.factory';

describe('createPaymentGateway', () => {
  let logger: jest.Mocked<PinoLogger>;

  beforeEach(() => {
    logger = createMockLogger();
  });

  it('binds the noop gateway when PAYMENT_PROVIDER is noop', () => {
    const gateway = createPaymentGateway(createMockConfig({ PAYMENT_PROVIDER: 'noop' }), logger);

    expect(gateway).toBeInstanceOf(NoopPaymentGateway);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('warns loudly when a gateway with no adapter is configured', () => {
    // An operator who set this believes the shop can take online payments.
    createPaymentGateway(createMockConfig({ PAYMENT_PROVIDER: 'bkash' }), logger);

    expect(logger.error).toHaveBeenCalled();
    expect(logger.error.mock.calls[0][0]).toMatchObject({ provider: 'bkash' });
  });

  it('still refuses every charge, so an unimplemented gateway cannot fake a payment', async () => {
    const gateway = createPaymentGateway(createMockConfig({ PAYMENT_PROVIDER: 'bkash' }), logger);

    await expect(
      gateway.charge({ amountPoysha: 100n, orderNumber: 'BB-1', payerPhone: null }),
    ).resolves.toMatchObject({ ok: false });
  });
});
