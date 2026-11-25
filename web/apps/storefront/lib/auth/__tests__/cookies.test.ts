import { describe, expect, it } from 'vitest';

import { fakeJar } from '../../../test/cookieJar';
import {
  clearSession,
  secondsUntil,
  writeDeviceId,
  writeMfaChallenge,
  writeSession,
} from '../cookies';

const NOW = Date.parse('2026-11-19T10:00:00Z');
const TOKENS = {
  accessToken: 'at',
  expiresAt: '2026-11-19T10:30:00Z',
  refreshToken: 'rt',
  refreshExpiresAt: '2026-12-19T10:00:00Z',
};

describe('session cookies', () => {
  it('keeps both tokens in httpOnly, Secure, SameSite=Lax cookies that expire with them', () => {
    const jar = fakeJar({ bb_mfa: 'pending' });
    writeSession(jar, TOKENS, NOW);

    expect(jar.values.get('bb_session')).toBe('at');
    expect(jar.options.get('bb_session')).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 1800,
    });
    expect(jar.values.get('bb_refresh')).toBe('rt');
    expect(jar.options.get('bb_refresh')?.maxAge).toBe(30 * 24 * 60 * 60);
    expect(jar.values.has('bb_mfa')).toBe(false);
  });

  it('clears every session cookie but keeps the device id', () => {
    const jar = fakeJar({ bb_session: 'a', bb_refresh: 'r', bb_mfa: 'm', bb_device: 'd' });
    clearSession(jar);
    expect([...jar.values.keys()]).toEqual(['bb_device']);
  });

  it('holds a pending MFA challenge for five minutes', () => {
    const jar = fakeJar();
    writeMfaChallenge(jar, 'mfa-token');
    expect(jar.options.get('bb_mfa')?.maxAge).toBe(300);
  });

  it('keeps the device id for the 400 days browsers allow', () => {
    const jar = fakeJar();
    writeDeviceId(jar, 'device-1');
    expect(jar.options.get('bb_device')).toMatchObject({ httpOnly: true, maxAge: 400 * 86400 });
  });

  it('never gives a cookie a negative lifetime', () => {
    expect(secondsUntil('2026-11-19T09:00:00Z', NOW)).toBe(0);
  });
});
