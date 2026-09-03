import { Language, User, UserRole } from '../../infra/prisma/prisma-client';
import { AuthMapper } from './auth.mapper';
import { LoginResult } from './login.service';
import { IssuedSession } from './sessions/session.service';

const userRow = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  supabaseUserId: '11111111-1111-1111-1111-111111111111',
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
      supabaseUserId: '11111111-1111-1111-1111-111111111111',
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
