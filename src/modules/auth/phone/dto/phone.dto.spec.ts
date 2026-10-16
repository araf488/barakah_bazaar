import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PhoneConfirmDto, PhoneRequestDto } from './phone.dto';

const strict = { whitelist: true, forbidNonWhitelisted: true };

describe('phone DTO validation', () => {
  describe('PhoneRequestDto', () => {
    const check = (payload: object) => validate(plainToInstance(PhoneRequestDto, payload), strict);

    it.each(['01712345678', '+8801712345678', ' 01712345678 '])('accepts %j', async (phone) => {
      await expect(check({ phone })).resolves.toEqual([]);
    });

    it('trims the number before it is read', () => {
      expect(plainToInstance(PhoneRequestDto, { phone: ' 01712345678 ' }).phone).toBe(
        '01712345678',
      );
    });

    it.each(['8801712345678', '017-1234-5678', '01212345678', '', '   '])(
      'rejects %j',
      async (phone) => {
        const errors = await check({ phone });

        expect(errors.map((error) => error.property)).toEqual(['phone']);
      },
    );

    it('rejects a missing number and a non-string number', async () => {
      expect(await check({})).toHaveLength(1);
      expect(await check({ phone: 1712345678 })).toHaveLength(1);
    });
  });

  describe('PhoneConfirmDto', () => {
    const valid = { phone: '01712345678', code: '012345' };
    const check = (payload: object) => validate(plainToInstance(PhoneConfirmDto, payload), strict);

    it('accepts a code with leading zeros', async () => {
      await expect(check(valid)).resolves.toEqual([]);
    });

    it.each(['48 2913', '12345', '1234567', 'abcdef', ''])('rejects code %j', async (code) => {
      const errors = await check({ ...valid, code });

      expect(errors.map((error) => error.property)).toEqual(['code']);
    });

    it('rejects an extra field', async () => {
      const errors = await check({ ...valid, userId: 'someone-else' });

      expect(errors.map((error) => error.property)).toContain('userId');
    });
  });
});
