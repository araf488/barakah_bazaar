import { describe, expect, it } from 'vitest';

import { deviceNameOf } from '../device';

const WEBKIT = 'AppleWebKit/537.36 (KHTML, like Gecko)';

describe('deviceNameOf', () => {
  it.each([
    [
      `Mozilla/5.0 (Linux; Android 14; Pixel 8) ${WEBKIT} Chrome/131.0.0.0 Mobile Safari/537.36`,
      'Chrome',
      'Android',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      'Safari',
      'iOS',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
      'Chrome',
      'iOS',
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Safari',
      'iPadOS',
    ],
    [
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${WEBKIT} Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0`,
      'Edge',
      'Windows',
    ],
    [
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${WEBKIT} Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0`,
      'Opera',
      'Windows',
    ],
    [
      `Mozilla/5.0 (Linux; Android 14; SM-S918B) ${WEBKIT} SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36`,
      'Samsung Internet',
      'Android',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.1; rv:132.0) Gecko/20100101 Firefox/132.0',
      'Firefox',
      'macOS',
    ],
    [
      `Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) ${WEBKIT} Chrome/131.0.0.0 Safari/537.36`,
      'Chrome',
      'ChromeOS',
    ],
    [`Mozilla/5.0 (X11; Linux x86_64) ${WEBKIT} Chrome/131.0.0.0 Safari/537.36`, 'Chrome', 'Linux'],
  ])('names %s', (userAgent, browser, system) => {
    expect(deviceNameOf(userAgent)).toEqual({ browser, system });
  });

  it('names nothing it does not recognise', () => {
    expect(deviceNameOf('curl/8.4.0')).toEqual({ browser: null, system: null });
  });

  it('names nothing without a user agent', () => {
    expect(deviceNameOf(null)).toEqual({ browser: null, system: null });
  });
});
