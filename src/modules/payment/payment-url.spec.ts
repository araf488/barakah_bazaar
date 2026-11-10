import { joinUrl, stripTrailingSlashes } from './payment-url';

describe('payment URLs', () => {
  it.each([
    ['https://api.x', 'https://api.x'],
    ['https://api.x/', 'https://api.x'],
    ['https://api.x///', 'https://api.x'],
    ['', ''],
  ])('strips the trailing slashes of %j', (value, expected) => {
    expect(stripTrailingSlashes(value)).toBe(expected);
  });

  it.each([
    ['https://api.x', 'https://api.x/api/v1/cb'],
    ['https://api.x/', 'https://api.x/api/v1/cb'],
    ['https://x/backend/', 'https://x/backend/api/v1/cb'],
    ['https://x/backend', 'https://x/backend/api/v1/cb'],
  ])('joins %j with exactly one slash', (base, expected) => {
    expect(joinUrl(base, 'api/v1/cb')).toBe(expected);
  });
});
