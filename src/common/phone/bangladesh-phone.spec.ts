import { BANGLADESH_MOBILE_PATTERN, BangladeshPhone } from './bangladesh-phone';

describe('BangladeshPhone', () => {
  describe('isValid', () => {
    it.each(['01312345678', '01712345678', '01912345678', '+8801712345678'])(
      'accepts %s',
      (value) => {
        expect(BangladeshPhone.isValid(value)).toBe(true);
      },
    );

    it.each([
      ['01212345678', 'operator prefix 2 is not issued'],
      ['0171234567', 'one digit short'],
      ['017123456789', 'one digit long'],
      ['8801712345678', 'international form without the plus'],
      ['+88 01712345678', 'contains a space'],
      ['+8801212345678', 'valid country code, invalid operator prefix'],
      ['', 'empty'],
      ['not a phone', 'not digits'],
    ])('rejects %s (%s)', (value) => {
      expect(BangladeshPhone.isValid(value)).toBe(false);
    });

    it('tolerates surrounding whitespace', () => {
      expect(BangladeshPhone.isValid('  01712345678 ')).toBe(true);
    });
  });

  describe('normalize', () => {
    it('converts the local form to E.164', () => {
      expect(BangladeshPhone.normalize('01712345678')).toBe('+8801712345678');
    });

    it('leaves an already-normalized number unchanged', () => {
      expect(BangladeshPhone.normalize('+8801712345678')).toBe('+8801712345678');
    });

    it('is idempotent', () => {
      const once = BangladeshPhone.normalize('01712345678');

      expect(BangladeshPhone.normalize(once)).toBe(once);
    });

    it('trims before converting', () => {
      expect(BangladeshPhone.normalize(' 01712345678 ')).toBe('+8801712345678');
    });
  });

  describe('BANGLADESH_MOBILE_PATTERN', () => {
    it('is exported for DTO @Matches so the DTO and the service cannot disagree', () => {
      expect(BANGLADESH_MOBILE_PATTERN.test('01712345678')).toBe(true);
    });

    it('is not sticky or global, so repeated tests do not alternate', () => {
      expect(BANGLADESH_MOBILE_PATTERN.test('01712345678')).toBe(true);
      expect(BANGLADESH_MOBILE_PATTERN.test('01712345678')).toBe(true);
    });
  });
});
