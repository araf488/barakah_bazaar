import { Language, Session, User, UserRole } from '../../infra/prisma/prisma-client';
import { AuthMapper } from './auth.mapper';
import { LoginResult } from './login.service';
import { IssuedSession } from './sessions/session.service';

const userRow = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  email: 'customer@barakahbazaar.com.bd',
  phone: '+8801711111111',
  fullName: 'Rahim Uddin',
  passwordHash: null,
  emailVerifiedAt: null,
  phoneVerifiedAt: null,
  passwordChangedAt: null,
  totpSecretEncrypted: null,
  totpEnabledAt: null,
  totpLastUsedStep: null,
  totpFailedAttempts: 0,
  totpLockedUntil: null,
  role: UserRole.CUSTOMER,
  preferredLanguage: Language.BN,
  isActive: true,
  lastSeenAt: new Date('2026-08-29T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-29T00:00:00.000Z'),
  ...overrides,
});

describe('AuthMapper', () => {
  it('maps every field of the profile contract', () => {
    expect(AuthMapper.toProfile(userRow())).toEqual({
      id: 'user-1',
      email: 'customer@barakahbazaar.com.bd',
      phone: '+8801711111111',
      fullName: 'Rahim Uddin',
      role: UserRole.CUSTOMER,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  it('never leaks the operational columns', () => {
    const profile = AuthMapper.toProfile(userRow());

    expect(profile).not.toHaveProperty('isActive');
    expect(profile).not.toHaveProperty('lastSeenAt');
    expect(profile).not.toHaveProperty('updatedAt');
  });

  it('passes a null name through rather than inventing one', () => {
    expect(AuthMapper.toProfile(userRow({ fullName: null })).fullName).toBeNull();
  });
});

const issuedSession = (overrides: Partial<IssuedSession> = {}): IssuedSession => ({
  accessToken: 'access-token',
  expiresAt: new Date('2026-01-01T00:30:00.000Z'),
  refreshToken: 'refresh-token',
  refreshExpiresAt: new Date('2026-02-01T00:00:00.000Z'),
  user: userRow(),
  ...overrides,
});

describe('AuthMapper.toSessionResponse', () => {
  it('carries the token quartet through unchanged', () => {
    const response = AuthMapper.toSessionResponse(issuedSession());

    expect(response).toMatchObject({
      kind: 'session',
      accessToken: 'access-token',
      expiresAt: new Date('2026-01-01T00:30:00.000Z'),
      refreshToken: 'refresh-token',
      refreshExpiresAt: new Date('2026-02-01T00:00:00.000Z'),
    });
  });

  it('never leaks the Prisma row — passwordHash and totpSecretEncrypted are absent', () => {
    const response = AuthMapper.toSessionResponse(
      issuedSession({
        user: userRow({ passwordHash: 'scrypt$...', totpSecretEncrypted: 'sealed' }),
      }),
    );

    expect(JSON.stringify(response)).not.toContain('scrypt$');
    expect(JSON.stringify(response)).not.toContain('sealed');
  });

  it('resolves STOREFRONT for a customer', () => {
    expect(AuthMapper.toSessionResponse(issuedSession()).portal).toBe('STOREFRONT');
  });

  it('resolves ADMIN for staff', () => {
    const response = AuthMapper.toSessionResponse(
      issuedSession({ user: userRow({ role: UserRole.OPS }) }),
    );

    expect(response.portal).toBe('ADMIN');
  });
});

describe('AuthMapper.toLoginResponse', () => {
  it('maps a session result through toSessionResponse', () => {
    const result: LoginResult = { kind: 'session', session: issuedSession(), portal: 'STOREFRONT' };

    expect(AuthMapper.toLoginResponse(result)).toMatchObject({
      kind: 'session',
      accessToken: 'access-token',
      portal: 'STOREFRONT',
    });
  });

  it('maps an mfa result to just the mfaToken', () => {
    const result: LoginResult = { kind: 'mfa', mfaToken: 'mfa-token' };

    expect(AuthMapper.toLoginResponse(result)).toEqual({ kind: 'mfa', mfaToken: 'mfa-token' });
  });

  it('maps an enrolment result to just the enrolmentToken', () => {
    const result: LoginResult = { kind: 'enrolment', enrolmentToken: 'enrolment-token' };

    expect(AuthMapper.toLoginResponse(result)).toEqual({
      kind: 'enrolment',
      enrolmentToken: 'enrolment-token',
    });
  });
});

const sessionRow = (overrides: Partial<Session> = {}): Session => ({
  id: 'session-1',
  userId: 'user-1',
  refreshTokenHash: 'hash-current',
  previousRefreshTokenHash: 'hash-previous',
  previousRotatedAt: new Date('2026-08-30T00:00:00.000Z'),
  expiresAt: new Date('2026-09-30T00:00:00.000Z'),
  absoluteExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
  revokedAt: null,
  lastUsedAt: new Date('2026-09-02T08:00:00.000Z'),
  deviceId: 'device-1',
  userAgent: 'Chrome/141',
  ipAddress: '203.0.113.42',
  createdAt: new Date('2026-08-29T00:00:00.000Z'),
  ...overrides,
});

describe('AuthMapper.toSessionSummary', () => {
  it('maps every field of the session summary contract', () => {
    expect(AuthMapper.toSessionSummary(sessionRow(), 'session-1')).toEqual({
      id: 'session-1',
      deviceId: 'device-1',
      userAgent: 'Chrome/141',
      ipAddress: '203.0.113.0',
      createdAt: new Date('2026-08-29T00:00:00.000Z'),
      lastUsedAt: new Date('2026-09-02T08:00:00.000Z'),
      current: true,
    });
  });

  it('never leaks the refresh-token hashes, current or previous', () => {
    const summary = AuthMapper.toSessionSummary(sessionRow(), 'session-1');

    expect(summary).not.toHaveProperty('refreshTokenHash');
    expect(summary).not.toHaveProperty('previousRefreshTokenHash');
    expect(JSON.stringify(summary)).not.toContain('hash-current');
    expect(JSON.stringify(summary)).not.toContain('hash-previous');
  });

  it('truncates an IPv4 address to its first three octets', () => {
    const summary = AuthMapper.toSessionSummary(
      sessionRow({ ipAddress: '203.0.113.42' }),
      'session-1',
    );

    expect(summary.ipAddress).toBe('203.0.113.0');
  });

  it('truncates a fully-written-out IPv6 address to its first four groups (a /64)', () => {
    // 2001:db8::/32 is the RFC 3849 documentation range — every group after "2001:db8" below
    // is arbitrary example data, not a real host.
    const summary = AuthMapper.toSessionSummary(
      sessionRow({ ipAddress: '2001:db8:85a3:8d3:1319:8a2e:370:7348' }),
      'session-1',
    );

    expect(summary.ipAddress).toBe('2001:db8:85a3:8d3::');
    expect(summary.ipAddress).not.toContain('1319');
    expect(summary.ipAddress).not.toContain('7348');
  });

  it('truncates the same IPv6 address to the same value, however it is spelled', () => {
    // Same address (RFC 3849 documentation range, see above), two spellings: fully written
    // out, and with "::" standing in for the two zero groups. A truncation keyed on the text
    // rather than the address would disagree.
    const expanded = AuthMapper.toSessionSummary(
      sessionRow({ ipAddress: '2001:db8:0:0:1319:8a2e:370:7348' }),
      'session-1',
    ).ipAddress;
    const compressed = AuthMapper.toSessionSummary(
      sessionRow({ ipAddress: '2001:db8::1319:8a2e:370:7348' }),
      'session-1',
    ).ipAddress;

    expect(compressed).toBe(expanded);
    expect(compressed).toBe('2001:db8:0:0::');
  });

  it('truncates a link-local address to a /64, not a single dropped group', () => {
    // fe80::1 is a link-local fixture, not a live host — exercises truncation on an address
    // outside every allowlisted documentation range.
    const summary = AuthMapper.toSessionSummary(
      sessionRow({
        // eslint-disable-next-line sonarjs/no-hardcoded-ip -- fixture address, not a live host
        ipAddress: 'fe80::1',
      }),
      'session-1',
    );

    // eslint-disable-next-line sonarjs/no-hardcoded-ip -- the /64 of the fixture address above
    expect(summary.ipAddress).toBe('fe80:0:0:0::');
  });

  it('truncates an IPv4-mapped IPv6 address as IPv6, not as its embedded IPv4 tail', () => {
    // ::ffff:203.0.113.42 embeds the RFC 5737 documentation range as its IPv4 tail — a
    // fixture, not a live host.
    const summary = AuthMapper.toSessionSummary(
      sessionRow({
        // eslint-disable-next-line sonarjs/no-hardcoded-ip -- fixture address, not a live host
        ipAddress: '::ffff:203.0.113.42',
      }),
      'session-1',
    );

    // The embedded IPv4 octets live in the address's last 32 bits, entirely outside the
    // /64 this keeps — so, correctly, none of them survive truncation.
    // eslint-disable-next-line sonarjs/no-hardcoded-ip -- the /64 of the fixture address above
    expect(summary.ipAddress).toBe('0:0:0:0::');
    expect(summary.ipAddress).not.toContain('203');
  });

  it('redacts an address it cannot classify rather than emitting it whole', () => {
    const summary = AuthMapper.toSessionSummary(
      sessionRow({ ipAddress: 'not-an-ip-address' }),
      'session-1',
    );

    expect(summary.ipAddress).toBeNull();
  });

  it('passes a null ip through as null', () => {
    const summary = AuthMapper.toSessionSummary(sessionRow({ ipAddress: null }), 'session-1');

    expect(summary.ipAddress).toBeNull();
  });

  it('marks the row matching the current session id as current', () => {
    expect(AuthMapper.toSessionSummary(sessionRow({ id: 'session-1' }), 'session-1').current).toBe(
      true,
    );
  });

  it('marks every other row as not current', () => {
    expect(AuthMapper.toSessionSummary(sessionRow({ id: 'session-2' }), 'session-1').current).toBe(
      false,
    );
  });
});
