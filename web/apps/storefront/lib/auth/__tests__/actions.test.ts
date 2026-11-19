import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeJar } from '../../../test/cookieJar';

const jar = { current: fakeJar() };
const REDIRECTED = new Error('NEXT_REDIRECT');

vi.mock('next/headers', () => ({
  cookies: async () => jar.current,
  headers: async () => new Headers({ 'user-agent': 'UA' }),
}));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'bn') }));
vi.mock('../../../i18n/navigation', () => ({
  redirect: vi.fn(() => {
    throw REDIRECTED;
  }),
}));
vi.mock('../../cart/merge', () => ({
  mergeGuestCart: vi.fn(async () => ({ moved: 0, refused: 0 })),
}));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  authApi: {
    login: vi.fn(),
    loginMfa: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    verifyEmail: vi.fn(),
    resendVerification: vi.fn(),
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
  },
}));

const actions = await import('../actions');
const { authApi } = await import('../api');
const { redirect } = await import('../../../i18n/navigation');
const { getLocale } = await import('next-intl/server');
const { mergeGuestCart } = await import('../../cart/merge');

const IDLE = { status: 'idle' } as const;
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const later = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
const SESSION = {
  kind: 'session' as const,
  portal: 'STOREFRONT' as const,
  accessToken: 'at',
  expiresAt: later(1800),
  refreshToken: 'rt',
  refreshExpiresAt: later(86400),
};
const CALLER = { deviceId: 'device-1', userAgent: 'UA' };

beforeEach(() => {
  jar.current = fakeJar({ bb_device: 'device-1' });
  vi.clearAllMocks();
});

describe('signInAction', () => {
  const signIn = (fields: Record<string, string>) => actions.signInAction(IDLE, form(fields));

  it('stores the session in cookies and goes to the requested page', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ ok: true, data: SESSION });

    await expect(signIn({ email: 'a@b.co', password: 'pw', next: '/bn/p/ajwa' })).rejects.toBe(
      REDIRECTED,
    );

    expect(authApi.login).toHaveBeenCalledWith(CALLER, 'a@b.co', 'pw');
    expect(jar.current.values.get('bb_session')).toBe('at');
    expect(jar.current.values.get('bb_refresh')).toBe('rt');
    expect(redirect).toHaveBeenCalledWith({ href: '/p/ajwa', locale: 'bn' });
  });

  it('moves the guest cart into the account right after signing in', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ ok: true, data: SESSION });

    await expect(signIn({ email: 'a@b.co', password: 'pw' })).rejects.toBe(REDIRECTED);

    expect(mergeGuestCart).toHaveBeenCalledWith(jar.current, { ...CALLER, accessToken: 'at' });
  });

  it('moves no cart for staff, who are turned away', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ ok: true, data: { ...SESSION, portal: 'ADMIN' } });
    await signIn({ email: 'ops@b.co', password: 'pw' });
    expect(mergeGuestCart).not.toHaveBeenCalled();
  });

  it('refuses to follow `next` off the site', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ ok: true, data: SESSION });
    await expect(signIn({ email: 'a@b.co', password: 'pw', next: '//evil.example' })).rejects.toBe(
      REDIRECTED,
    );
    expect(redirect).toHaveBeenCalledWith({ href: '/', locale: 'bn' });
  });

  it('holds the MFA challenge in a cookie and asks for the code', async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      ok: true,
      data: { kind: 'mfa', mfaToken: 'mfa-1' },
    });

    await expect(signIn({ email: 'a@b.co', password: 'pw' })).resolves.toEqual({ status: 'mfa' });
    expect(jar.current.values.get('bb_mfa')).toBe('mfa-1');
    expect(jar.current.values.has('bb_session')).toBe(false);
  });

  it('turns staff away, revoking the session the API just opened', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ ok: true, data: { ...SESSION, portal: 'ADMIN' } });

    await expect(signIn({ email: 'ops@b.co', password: 'pw' })).resolves.toEqual({
      status: 'error',
      error: 'staffPortal',
    });
    expect(authApi.logout).toHaveBeenCalledWith({ ...CALLER, accessToken: 'at' });
    expect(jar.current.values.has('bb_session')).toBe(false);
  });

  it('turns away an account that must enrol in MFA (staff)', async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      ok: true,
      data: { kind: 'enrolment', enrolmentToken: 'e' },
    });
    await expect(signIn({ email: 'ops@b.co', password: 'pw' })).resolves.toEqual({
      status: 'error',
      error: 'staffPortal',
    });
  });

  it('says the credentials do not match on 401', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ ok: false, status: 401 });
    await expect(signIn({ email: 'a@b.co', password: 'pw' })).resolves.toEqual({
      status: 'error',
      error: 'credentials',
    });
  });

  it('does not call the API for an invalid email', async () => {
    await expect(signIn({ email: 'nope', password: 'pw' })).resolves.toEqual({
      status: 'error',
      error: 'emailInvalid',
    });
    expect(authApi.login).not.toHaveBeenCalled();
  });
});

describe('verifyMfaAction', () => {
  it('asks for the password again once the challenge cookie has lapsed', async () => {
    await expect(actions.verifyMfaAction(IDLE, form({ code: '123456' }))).resolves.toEqual({
      status: 'error',
      error: 'mfaExpired',
    });
    expect(authApi.loginMfa).not.toHaveBeenCalled();
  });

  it('signs in with the app code', async () => {
    jar.current = fakeJar({ bb_device: 'device-1', bb_mfa: 'mfa-1' });
    vi.mocked(authApi.loginMfa).mockResolvedValue({ ok: true, data: SESSION });

    await expect(actions.verifyMfaAction(IDLE, form({ code: '123456' }))).rejects.toBe(REDIRECTED);

    expect(authApi.loginMfa).toHaveBeenCalledWith(CALLER, 'mfa-1', { code: '123456' });
    expect(jar.current.values.get('bb_session')).toBe('at');
    expect(jar.current.values.has('bb_mfa')).toBe(false);
  });

  it('accepts a recovery code instead', async () => {
    jar.current = fakeJar({ bb_device: 'device-1', bb_mfa: 'mfa-1' });
    vi.mocked(authApi.loginMfa).mockResolvedValue({ ok: true, data: SESSION });
    await expect(actions.verifyMfaAction(IDLE, form({ recoveryCode: 'abcd-efgh' }))).rejects.toBe(
      REDIRECTED,
    );
    expect(authApi.loginMfa).toHaveBeenCalledWith(CALLER, 'mfa-1', { recoveryCode: 'abcd-efgh' });
  });

  it('says the code did not work on 401', async () => {
    jar.current = fakeJar({ bb_device: 'device-1', bb_mfa: 'mfa-1' });
    vi.mocked(authApi.loginMfa).mockResolvedValue({ ok: false, status: 401 });
    await expect(actions.verifyMfaAction(IDLE, form({ code: '123456' }))).resolves.toEqual({
      status: 'error',
      error: 'code',
    });
  });

  it('rejects a malformed code without a round trip', async () => {
    jar.current = fakeJar({ bb_device: 'device-1', bb_mfa: 'mfa-1' });
    await expect(actions.verifyMfaAction(IDLE, form({ code: '12' }))).resolves.toEqual({
      status: 'error',
      error: 'codeInvalid',
    });
  });
});

describe('registerAction', () => {
  const valid = {
    fullName: 'Tahmina Rahman',
    email: 'a@b.co',
    password: 'long enough pw',
    confirm: 'long enough pw',
  };

  it('registers in the page’s language and moves on to the emailed code', async () => {
    vi.mocked(authApi.register).mockResolvedValue({
      ok: true,
      data: { status: 'pending_verification' },
    });

    await expect(actions.registerAction(IDLE, form(valid))).resolves.toEqual({
      status: 'sent',
      email: 'a@b.co',
    });
    expect(authApi.register).toHaveBeenCalledWith(CALLER, {
      email: 'a@b.co',
      password: 'long enough pw',
      fullName: 'Tahmina Rahman',
      preferredLanguage: 'BN',
    });
  });

  it('registers English speakers as EN', async () => {
    vi.mocked(getLocale).mockResolvedValueOnce('en');
    vi.mocked(authApi.register).mockResolvedValue({
      ok: true,
      data: { status: 'pending_verification' },
    });
    await actions.registerAction(IDLE, form(valid));
    expect(vi.mocked(authApi.register).mock.calls[0]?.[1].preferredLanguage).toBe('EN');
  });

  it.each([
    [{ fullName: '' }, 'nameMissing'],
    [{ email: 'x' }, 'emailInvalid'],
    [{ password: 'short', confirm: 'short' }, 'passwordShort'],
    [{ confirm: 'something else' }, 'passwordMismatch'],
  ])('refuses %o as %s without calling the API', async (override, error) => {
    await expect(actions.registerAction(IDLE, form({ ...valid, ...override }))).resolves.toEqual({
      status: 'error',
      error,
    });
    expect(authApi.register).not.toHaveBeenCalled();
  });
});

describe('verifyEmailAction', () => {
  it('confirms by the emailed token', async () => {
    vi.mocked(authApi.verifyEmail).mockResolvedValue({ ok: true, data: { emailVerified: true } });
    await expect(actions.verifyEmailAction(IDLE, form({ token: 'tok' }))).resolves.toEqual({
      status: 'done',
    });
    expect(authApi.verifyEmail).toHaveBeenCalledWith(CALLER, { token: 'tok' });
  });

  it('confirms by email and code', async () => {
    vi.mocked(authApi.verifyEmail).mockResolvedValue({ ok: true, data: { emailVerified: true } });
    await actions.verifyEmailAction(IDLE, form({ email: 'a@b.co', code: '123456' }));
    expect(authApi.verifyEmail).toHaveBeenCalledWith(CALLER, { email: 'a@b.co', code: '123456' });
  });

  it('says an expired link has expired', async () => {
    vi.mocked(authApi.verifyEmail).mockResolvedValue({ ok: false, status: 410 });
    await expect(actions.verifyEmailAction(IDLE, form({ token: 'old' }))).resolves.toEqual({
      status: 'error',
      error: 'expired',
    });
  });
});

describe('password reset and resend', () => {
  it('answers "sent" for any address, as the API does', async () => {
    vi.mocked(authApi.forgotPassword).mockResolvedValue({
      ok: true,
      data: { status: 'reset_requested' },
    });
    await expect(actions.forgotPasswordAction(IDLE, form({ email: 'a@b.co' }))).resolves.toEqual({
      status: 'sent',
      email: 'a@b.co',
    });
  });

  it('resends a verification link', async () => {
    vi.mocked(authApi.resendVerification).mockResolvedValue({ ok: true, data: { status: 'ok' } });
    await expect(
      actions.resendVerificationAction(IDLE, form({ email: 'a@b.co' })),
    ).resolves.toEqual({ status: 'sent', email: 'a@b.co' });
  });

  it('resets by token with a confirmed new password', async () => {
    vi.mocked(authApi.resetPassword).mockResolvedValue({ ok: true, data: { passwordReset: true } });
    const state = await actions.resetPasswordAction(
      IDLE,
      form({ token: 'tok', password: 'long enough pw', confirm: 'long enough pw' }),
    );
    expect(state).toEqual({ status: 'done' });
    expect(authApi.resetPassword).toHaveBeenCalledWith(CALLER, {
      token: 'tok',
      newPassword: 'long enough pw',
    });
  });

  it('needs the email and code when there is no token', async () => {
    await expect(
      actions.resetPasswordAction(
        IDLE,
        form({ email: 'a@b.co', code: '1', password: 'long enough pw', confirm: 'long enough pw' }),
      ),
    ).resolves.toEqual({ status: 'error', error: 'codeInvalid' });
  });
});

describe('signOutAction', () => {
  it('revokes the session at the API, clears the cookies and goes home', async () => {
    jar.current = fakeJar({ bb_device: 'device-1', bb_session: 'at', bb_refresh: 'rt' });
    vi.mocked(authApi.logout).mockResolvedValue({ ok: true, data: undefined });

    await expect(actions.signOutAction()).rejects.toBe(REDIRECTED);

    expect(authApi.logout).toHaveBeenCalledWith({ ...CALLER, accessToken: 'at' });
    expect([...jar.current.values.keys()]).toEqual(['bb_device']);
    expect(redirect).toHaveBeenCalledWith({ href: '/', locale: 'bn' });
  });

  it('still clears the cookies when there is no live session', async () => {
    jar.current = fakeJar({ bb_device: 'device-1', bb_refresh: 'rt' });
    await expect(actions.signOutAction()).rejects.toBe(REDIRECTED);
    expect(authApi.logout).not.toHaveBeenCalled();
    expect(jar.current.values.has('bb_refresh')).toBe(false);
  });
});
