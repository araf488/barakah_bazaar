import { PinoLogger } from 'nestjs-pino';
import { createMockConfig, createMockLogger } from '../../../../test/support/mocks';
import { BkashPaymentGateway } from './bkash-payment.gateway';
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

  it('binds the bKash gateway when PAYMENT_PROVIDER is bkash', () => {
    const gateway = createPaymentGateway(createMockConfig({ PAYMENT_PROVIDER: 'bkash' }), logger);

    expect(gateway).toBeInstanceOf(BkashPaymentGateway);
  });

  it('keeps the bKash gateway refusing a one-call charge, so it cannot fake a payment', async () => {
    const gateway = createPaymentGateway(createMockConfig({ PAYMENT_PROVIDER: 'bkash' }), logger);

    await expect(
      gateway.charge({ amountPoysha: 100n, orderNumber: 'BB-1', payerPhone: null }),
    ).resolves.toMatchObject({ ok: false });
  });

  it('falls back to the noop gateway for an unknown provider', () => {
    const gateway = createPaymentGateway(createMockConfig({ PAYMENT_PROVIDER: 'other' }), logger);

    expect(gateway).toBeInstanceOf(NoopPaymentGateway);
  });
});
