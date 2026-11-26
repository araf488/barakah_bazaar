import { describe, expect, it } from 'vitest';

import { fakeJar } from '../../../test/cookieJar';
import {
  clearStaffChallenge,
  clearStaffSession,
  readStaffChallenge,
  writeStaffChallenge,
  writeStaffSession,
} from '../cookies';

const NOW = Date.parse('2026-11-26T10:00:00.000Z');
const TOKENS = {
  accessToken: 'at',
  expiresAt: '2026-11-26T10:30:00.000Z',
  refreshToken: 'rt',
  refreshExpiresAt: '2026-11-26T22:00:00.000Z',
};
const STAFF_SCOPE = { httpOnly: true, secure: true, sameSite: 'strict', path: '/admin' };

describe('writeStaffSession', () => {
  it('keeps both tokens in httpOnly cookies scoped to /admin, apart from the shop’s', () => {
    const jar = fakeJar();

    writeStaffSession(jar, TOKENS, NOW);

    expect(jar.values.get('bb_staff_session')).toBe('at');
    expect(jar.options.get('bb_staff_session')).toEqual({ ...STAFF_SCOPE, maxAge: 1800 });
    expect(jar.values.get('bb_staff_refresh')).toBe('rt');
    expect(jar.options.get('bb_staff_refresh')).toEqual({ ...STAFF_SCOPE, maxAge: 43200 });
    expect(jar.values.has('bb_session')).toBe(false);
  });

  it('ends the pending second step once the session exists', () => {
    const jar = fakeJar({ bb_staff_challenge: 'mfa:tok' });

    writeStaffSession(jar, TOKENS, NOW);

    expect(jar.options.get('bb_staff_challenge')).toEqual({ ...STAFF_SCOPE, maxAge: 0 });
  });
});

describe('clearStaffSession', () => {
  it('expires every staff cookie on /admin, where they live, leaving the shop’s alone', () => {
    const jar = fakeJar({ bb_session: 'customer' });

    clearStaffSession(jar);

    for (const name of ['bb_staff_session', 'bb_staff_refresh', 'bb_staff_challenge']) {
      expect(jar.options.get(name)).toEqual({ ...STAFF_SCOPE, maxAge: 0 });
    }
    expect(jar.values.get('bb_session')).toBe('customer');
    expect(jar.delete).not.toHaveBeenCalled();
  });
});

describe('staff challenge', () => {
  it('stores the kind with the token for five minutes', () => {
    const jar = fakeJar();

    writeStaffChallenge(jar, { kind: 'enrolment', token: 'e-tok' });

    expect(jar.values.get('bb_staff_challenge')).toBe('enrolment:e-tok');
    expect(jar.options.get('bb_staff_challenge')).toEqual({ ...STAFF_SCOPE, maxAge: 300 });
  });

  it('reads the token back only for the kind it was written as', () => {
    expect(readStaffChallenge('mfa:m-tok', 'mfa')).toBe('m-tok');
    expect(readStaffChallenge('mfa:m-tok', 'enrolment')).toBeNull();
    expect(readStaffChallenge('mfa:', 'mfa')).toBeNull();
    expect(readStaffChallenge(undefined, 'mfa')).toBeNull();
  });

  it('can be cleared on its own', () => {
    const jar = fakeJar({ bb_staff_challenge: 'enrolment:e' });

    clearStaffChallenge(jar);

    expect(jar.options.get('bb_staff_challenge')).toEqual({ ...STAFF_SCOPE, maxAge: 0 });
  });
});
