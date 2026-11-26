import { describe, expect, it } from 'vitest';

import { browserOf, clientIpOf } from '../browser';

describe('clientIpOf', () => {
  it('reads the address nginx wrote', () => {
    expect(clientIpOf(new Headers({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('takes the last entry, the one the edge proxy appended, not what the browser claimed', () => {
    const incoming = new Headers({ 'x-forwarded-for': '10.0.0.1, 198.51.100.4 ,  203.0.113.7' });
    expect(clientIpOf(incoming)).toBe('203.0.113.7');
  });

  it('keeps an IPv6 address', () => {
    expect(clientIpOf(new Headers({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
  });

  it('is null without the header', () => {
    expect(clientIpOf(new Headers())).toBeNull();
  });

  it('drops anything that is not an address', () => {
    expect(clientIpOf(new Headers({ 'x-forwarded-for': '203.0.113.7; drop' }))).toBeNull();
    expect(clientIpOf(new Headers({ 'x-forwarded-for': 'unknown' }))).toBeNull();
    expect(clientIpOf(new Headers({ 'x-forwarded-for': '1'.repeat(46) }))).toBeNull();
  });
});

describe('browserOf', () => {
  it('carries the user agent and the address', () => {
    const incoming = new Headers({ 'user-agent': 'UA', 'x-forwarded-for': '203.0.113.7' });
    expect(browserOf(incoming)).toEqual({ userAgent: 'UA', clientIp: '203.0.113.7' });
  });

  it('leaves the address out when there is none', () => {
    expect(browserOf(new Headers({ 'user-agent': 'UA' }))).toEqual({ userAgent: 'UA' });
  });
});
