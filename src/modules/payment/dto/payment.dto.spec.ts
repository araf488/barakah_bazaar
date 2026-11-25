import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaymentQueryDto, ResolveRefundClaimDto } from './payment.dto';

const errorsFor = async <T extends object>(type: new () => T, body: unknown) =>
  validate(plainToInstance(type, body), { whitelist: true, forbidNonWhitelisted: true });

describe('ResolveRefundClaimDto', () => {
  it.each([
    [{ outcome: 'refunded' }],
    [{ outcome: 'refunded', refundTransactionId: 'RFD-PORTAL-1' }],
    [{ outcome: 'not-refunded' }],
  ])('accepts %p', async (body) => {
    await expect(errorsFor(ResolveRefundClaimDto, body)).resolves.toEqual([]);
  });

  it.each(['REFUNDED', 'refund', '', null, 42])('rejects the outcome %p', async (outcome) => {
    const errors = await errorsFor(ResolveRefundClaimDto, { outcome });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('outcome');
  });

  it('rejects a body without an outcome', async () => {
    const errors = await errorsFor(ResolveRefundClaimDto, {});

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('outcome');
  });

  it.each([['   '], [42], ['X'.repeat(65)]])('rejects the refund trxID %p', async (id) => {
    const errors = await errorsFor(ResolveRefundClaimDto, {
      outcome: 'refunded',
      refundTransactionId: id,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('refundTransactionId');
  });

  it('trims the refund trxID', () => {
    const dto = plainToInstance(ResolveRefundClaimDto, {
      outcome: 'refunded',
      refundTransactionId: '  RFD-PORTAL-1 ',
    });

    expect(dto.refundTransactionId).toBe('RFD-PORTAL-1');
  });

  it('rejects an unknown field', async () => {
    const errors = await errorsFor(ResolveRefundClaimDto, { outcome: 'refunded', amount: 1 });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('amount');
  });
});

describe('PaymentQueryDto', () => {
  it('accepts the status and direction a stale refund claim is listed by', async () => {
    await expect(
      errorsFor(PaymentQueryDto, { status: 'PENDING', direction: 'REFUND' }),
    ).resolves.toEqual([]);
  });

  it.each([
    ['status', { status: 'STUCK' }],
    ['direction', { direction: 'SIDEWAYS' }],
  ])('rejects an unknown %s', async (property, body) => {
    const errors = await errorsFor(PaymentQueryDto, body);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe(property);
  });
});
