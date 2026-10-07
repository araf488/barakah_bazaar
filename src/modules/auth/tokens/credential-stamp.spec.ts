import { credentialStampOf } from './credential-stamp';

describe('credentialStampOf', () => {
  it('is 0 for an account whose password has never changed', () => {
    expect(credentialStampOf({ passwordChangedAt: null })).toBe(0);
  });

  it('is the epoch milliseconds of passwordChangedAt once it is set', () => {
    expect(credentialStampOf({ passwordChangedAt: new Date('2026-10-06T08:00:00.000Z') })).toBe(
      1791273600000,
    );
  });
});
