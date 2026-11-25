import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SwitchPaymentMethodDto } from './order.dto';

const errorsFor = async (body: unknown) =>
  validate(plainToInstance(SwitchPaymentMethodDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('SwitchPaymentMethodDto', () => {
  it('accepts CASH_ON_DELIVERY, the only method an order may switch to', async () => {
    await expect(errorsFor({ paymentMethod: 'CASH_ON_DELIVERY' })).resolves.toEqual([]);
  });

  it.each(['BKASH', 'CARD', 'cash_on_delivery', '', null, 42])(
    'rejects %p',
    async (paymentMethod) => {
      const errors = await errorsFor({ paymentMethod });

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('paymentMethod');
    },
  );

  it('rejects a body without a paymentMethod', async () => {
    const errors = await errorsFor({});

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('paymentMethod');
  });
});
