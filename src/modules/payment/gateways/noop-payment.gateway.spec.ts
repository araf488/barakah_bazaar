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
      gateway.refund({
        amountPoysha: 250000n,
        originalReference: 'PAY-1',
        transactionId: 'TRX123',
      }),
    ).resolves.toMatchObject({ ok: false, ambiguous: false });
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

  it('refuses to start a checkout, so a noop provider never sends a customer anywhere', async () => {
    await expect(
      gateway.createCheckout({
        amountPoysha: 250000n,
        orderNumber: 'BB-20260830-000042',
        callbackUrl: 'https://api.example.test/api/v1/payments/bkash/callback',
        payerReference: 'user-1',
      }),
    ).resolves.toEqual({ ok: false, failureReason: 'No payment gateway is configured.' });
  });

  it('answers error, never completed, when asked to execute a checkout', async () => {
    await expect(gateway.executeCheckout('PAY-1')).resolves.toEqual({
      kind: 'error',
      reason: 'No payment gateway is configured.',
    });
  });

  it('answers error, never completed, when asked to query a checkout', async () => {
    await expect(gateway.queryCheckout('PAY-1')).resolves.toEqual({
      kind: 'error',
      reason: 'No payment gateway is configured.',
    });
  });

  it('warns on each checkout call and logs neither the amount nor the callback URL', async () => {
    await gateway.createCheckout({
      amountPoysha: 250000n,
      orderNumber: 'BB-20260830-000042',
      callbackUrl: 'https://api.example.test/api/v1/payments/bkash/callback',
      payerReference: 'user-1',
    });
    await gateway.executeCheckout('PAY-1');
    await gateway.queryCheckout('PAY-2');

    expect(logger.warn).toHaveBeenCalledTimes(3);
    const logged = JSON.stringify(logger.warn.mock.calls);
    expect(logged).not.toContain('250000');
    expect(logged).not.toContain('callback');
  });
});
