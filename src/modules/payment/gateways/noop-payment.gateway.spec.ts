import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../../test/support/mocks';
import { NoopPaymentGateway } from './noop-payment.gateway';

describe('NoopPaymentGateway', () => {
  let logger: jest.Mocked<PinoLogger>;
  let gateway: NoopPaymentGateway;

  beforeEach(() => {
    logger = createMockLogger();
    gateway = new NoopPaymentGateway(logger);
  });

  it('refuses a charge rather than reporting a payment nobody made', async () => {
    await expect(
      gateway.charge({
        amountPoysha: 250000n,
        orderNumber: 'BB-20260830-000042',
        payerPhone: '+8801711111111',
      }),
    ).resolves.toEqual({
      ok: false,
      reference: null,
      pending: false,
      failureReason: 'No payment gateway is configured.',
    });
  });

  it('refuses a refund for the same reason', async () => {
    await expect(
      gateway.refund({ amountPoysha: 250000n, originalReference: 'TRX123' }),
    ).resolves.toMatchObject({ ok: false });
  });

  it('warns rather than staying silent, so a disabled gateway is visible in the logs', async () => {
    await gateway.charge({
      amountPoysha: 250000n,
      orderNumber: 'BB-20260830-000042',
      payerPhone: null,
    });

    expect(logger.warn).toHaveBeenCalled();
  });

  it('never logs the amount', async () => {
    await gateway.charge({
      amountPoysha: 250000n,
      orderNumber: 'BB-20260830-000042',
      payerPhone: null,
    });

    expect(JSON.stringify(logger.warn.mock.calls[0][0])).not.toContain('250000');
  });
});
