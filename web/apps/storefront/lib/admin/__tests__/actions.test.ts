import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeJar } from '../../../test/cookieJar';

const jar = { current: fakeJar() };
const REDIRECTED = new Error('NEXT_REDIRECT');

vi.mock('next/headers', () => ({
  cookies: async () => jar.current,
  headers: async () => new Headers({ 'user-agent': 'UA' }),
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw REDIRECTED;
  }),
}));
vi.mock('../../auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/api')>()),
  authApi: { login: vi.fn(), loginMfa: vi.fn(), logout: vi.fn() },
}));
vi.mock('../api', () => ({
  staffApi: { mfaSetup: vi.fn(), mfaEnable: vi.fn(), acceptInvitation: vi.fn() },
}));

const actions = await import('../actions');
const { authApi } = await import('../../auth/api');
const { staffApi } = await import('../api');
const { redirect } = await import('next/navigation');

const IDLE = { status: 'idle' } as const;
const CALLER = { deviceId: 'device-1', userAgent: 'UA' };
const later = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
const session = (portal: 'ADMIN' | 'STOREFRONT') => ({
  kind: 'session' as const,
  portal,
  accessToken: 'at',
  expiresAt: later(1800),
  refreshToken: 'rt',
  refreshExpiresAt: later(43200),
});
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const SIGN_IN = {
  email: 'ops@barakah.test',
  password: 'correct horse battery',
  next: '/admin/orders',
};

beforeEach(() => {
  vi.clearAllMocks();
  jar.current = fakeJar({ bb_device: 'device-1' });
});

describe('staffSignInAction', () => {
  it('asks for the code next, carrying where the staff member was going', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ ok: true, data: { kind: 'mfa', mfaToken: 'm' } });

    await expect(actions.staffSignInAction(IDLE, form(SIGN_IN))).rejects.toBe(REDIRECTED);

    expect(authApi.login).toHaveBeenCalledWith(CALLER, SIGN_IN.email, SIGN_IN.password);
    expect(jar.current.values.get('bb_staff_challenge')).toBe('mfa:m');
    expect(redirect).toHaveBeenCalledWith('/admin/sign-in/verify?next=%2Fadmin%2Forders');
  });

  it('sends a staff member without an authenticator to set one up', async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      ok: true,
      data: { kind: 'enrolment', enrolmentToken: 'e' },
    });

    await expect(actions.staffSignInAction(IDLE, form(SIGN_IN))).rejects.toBe(REDIRECTED);

    expect(jar.current.values.get('bb_staff_challenge')).toBe('enrolment:e');
    expect(redirect).toHaveBeenCalledWith('/admin/sign-in/setup');
  });

  it('signs a staff member straight in when the API issues a session', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ ok: true, data: session('ADMIN') });

    await expect(actions.staffSignInAction(IDLE, form(SIGN_IN))).rejects.toBe(REDIRECTED);

    expect(jar.current.values.get('bb_staff_session')).toBe('at');
    expect(jar.current.values.has('bb_session')).toBe(false);
    expect(redirect).toHaveBeenCalledWith('/admin/orders');
  });

  it('ends a customer’s session at once and says the portal is for staff', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ ok: true, data: session('STOREFRONT') });

    await expect(actions.staffSignInAction(IDLE, form(SIGN_IN))).resolves.toMatchObject({
      status: 'error',
      error: 'notStaff',
    });

    expect(authApi.logout).toHaveBeenCalledWith({ ...CALLER, accessToken: 'at' });
    expect(jar.current.values.has('bb_staff_session')).toBe(false);
  });

  it('never redirects outside the portal', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ ok: true, data: session('ADMIN') });

    await expect(
      actions.staffSignInAction(IDLE, form({ ...SIGN_IN, next: '//evil.example' })),
    ).rejects.toBe(REDIRECTED);

    expect(redirect).toHaveBeenCalledWith('/admin');
  });

  it.each([
    [{ email: 'nope' }, 'emailInvalid'],
    [{ password: '' }, 'passwordMissing'],
  ])('refuses %o as %s without calling the API', async (override, error) => {
    await expect(
      actions.staffSignInAction(IDLE, form({ ...SIGN_IN, ...override })),
    ).resolves.toMatchObject({ status: 'error', error });
    expect(authApi.login).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'credentials'],
    [403, 'blocked'],
    [429, 'tooMany'],
    [0, 'unavailable'],
    [503, 'unavailable'],
  ])('reads a %i refusal as %s', async (status, error) => {
    vi.mocked(authApi.login).mockResolvedValue({ ok: false, status });

    await expect(actions.staffSignInAction(IDLE, form(SIGN_IN))).resolves.toMatchObject({
      status: 'error',
      error,
    });
  });
});

describe('verifyStaffCodeAction', () => {
  beforeEach(() => {
    jar.current = fakeJar({ bb_device: 'device-1', bb_staff_challenge: 'mfa:m' });
  });

  it('signs in with the authenticator code', async () => {
    vi.mocked(authApi.loginMfa).mockResolvedValue({ ok: true, data: session('ADMIN') });

    await expect(
      actions.verifyStaffCodeAction(IDLE, form({ method: 'code', code: '123456', next: '/admin' })),
    ).rejects.toBe(REDIRECTED);

    expect(authApi.loginMfa).toHaveBeenCalledWith(CALLER, 'm', { code: '123456' });
    expect(jar.current.values.get('bb_staff_session')).toBe('at');
    expect(redirect).toHaveBeenCalledWith('/admin');
  });

  it('accepts a recovery code typed with spaces, dashes or capitals', async () => {
    vi.mocked(authApi.loginMfa).mockResolvedValue({ ok: true, data: session('ADMIN') });

    await expect(
      actions.verifyStaffCodeAction(
        IDLE,
        form({ method: 'recovery', recoveryCode: '01234 56789-ABCDE F0123' }),
      ),
    ).rejects.toBe(REDIRECTED);

    expect(authApi.loginMfa).toHaveBeenCalledWith(CALLER, 'm', {
      recoveryCode: '0123456789abcdef0123',
    });
  });

  it('starts over when the challenge has lapsed', async () => {
    jar.current = fakeJar({ bb_device: 'device-1' });

    await expect(
      actions.verifyStaffCodeAction(IDLE, form({ method: 'code', code: '123456' })),
    ).resolves.toMatchObject({ error: 'expired' });
    expect(authApi.loginMfa).not.toHaveBeenCalled();
  });

  it('does not take an enrolment challenge as an MFA one', async () => {
    jar.current = fakeJar({ bb_device: 'device-1', bb_staff_challenge: 'enrolment:e' });

    await expect(
      actions.verifyStaffCodeAction(IDLE, form({ method: 'code', code: '123456' })),
    ).resolves.toMatchObject({ error: 'expired' });
  });

  it('checks the code’s shape before calling the API', async () => {
    await expect(
      actions.verifyStaffCodeAction(IDLE, form({ method: 'code', code: '12345' })),
    ).resolves.toMatchObject({ error: 'codeFormat' });
    expect(authApi.loginMfa).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'code'],
    [429, 'locked'],
    [0, 'unavailable'],
  ])('reads a %i refusal as %s', async (status, error) => {
    vi.mocked(authApi.loginMfa).mockResolvedValue({ ok: false, status });

    await expect(
      actions.verifyStaffCodeAction(IDLE, form({ method: 'code', code: '123456' })),
    ).resolves.toMatchObject({ error });
  });
});

describe('authenticator setup', () => {
  beforeEach(() => {
    jar.current = fakeJar({ bb_device: 'device-1', bb_staff_challenge: 'enrolment:e' });
  });

  it('fetches the key with the enrolment token', async () => {
    vi.mocked(staffApi.mfaSetup).mockResolvedValue({
      ok: true,
      data: { secret: 'ABCD', otpauthUri: 'otpauth://totp/x' },
    });

    await expect(actions.startMfaSetupAction()).resolves.toEqual({
      status: 'ready',
      secret: 'ABCD',
      otpauthUri: 'otpauth://totp/x',
    });
    expect(staffApi.mfaSetup).toHaveBeenCalledWith(CALLER, 'e');
  });

  it('starts over when the enrolment token has lapsed or is refused', async () => {
    vi.mocked(staffApi.mfaSetup).mockResolvedValue({ ok: false, status: 401 });
    await expect(actions.startMfaSetupAction()).resolves.toMatchObject({ error: 'expired' });

    jar.current = fakeJar({ bb_device: 'device-1' });
    await expect(actions.startMfaSetupAction()).resolves.toMatchObject({ error: 'expired' });
  });

  it('confirms with a code, hands back the recovery codes and ends the challenge', async () => {
    vi.mocked(staffApi.mfaEnable).mockResolvedValue({
      ok: true,
      data: { recoveryCodes: ['a', 'b'] },
    });
    const ready = { status: 'ready' as const, secret: 'ABCD', otpauthUri: 'otpauth://totp/x' };

    await expect(actions.enableMfaAction(ready, form({ code: '654321' }))).resolves.toEqual({
      status: 'enabled',
      recoveryCodes: ['a', 'b'],
    });
    expect(staffApi.mfaEnable).toHaveBeenCalledWith(CALLER, 'e', '654321');
    expect(jar.current.options.get('bb_staff_challenge')).toMatchObject({ maxAge: 0 });
    expect(jar.current.values.has('bb_staff_session')).toBe(false);
  });

  it('says setup already finished when the API refuses a second key (409)', async () => {
    vi.mocked(staffApi.mfaSetup).mockResolvedValue({ ok: false, status: 409 });
    await expect(actions.startMfaSetupAction()).resolves.toMatchObject({ error: 'alreadyEnabled' });

    vi.mocked(staffApi.mfaEnable).mockResolvedValue({ ok: false, status: 409 });
    await expect(actions.enableMfaAction(IDLE, form({ code: '654321' }))).resolves.toMatchObject({
      error: 'alreadyEnabled',
    });
  });

  it('keeps the key on screen when the first code is wrong', async () => {
    vi.mocked(staffApi.mfaEnable).mockResolvedValue({ ok: false, status: 400 });
    const ready = { status: 'ready' as const, secret: 'ABCD', otpauthUri: 'otpauth://totp/x' };

    await expect(actions.enableMfaAction(ready, form({ code: '654321' }))).resolves.toMatchObject({
      status: 'error',
      error: 'code',
      secret: 'ABCD',
      otpauthUri: 'otpauth://totp/x',
    });
  });
});

describe('staffSignOutAction', () => {
  it('ends the session at the API, clears the staff cookies and goes to sign-in', async () => {
    jar.current = fakeJar({ bb_device: 'device-1', bb_staff_session: 'at', bb_session: 'shop' });

    await expect(actions.staffSignOutAction()).rejects.toBe(REDIRECTED);

    expect(authApi.logout).toHaveBeenCalledWith({ ...CALLER, accessToken: 'at' });
    expect(jar.current.options.get('bb_staff_session')).toMatchObject({
      maxAge: 0,
      path: '/admin',
    });
    expect(jar.current.values.get('bb_session')).toBe('shop');
    expect(redirect).toHaveBeenCalledWith('/admin/sign-in');
  });
});

describe('acceptInvitationAction', () => {
  const VALID = {
    token: 'tok',
    fullName: ' Rahim Uddin ',
    password: 'Mango-season-2026',
    confirm: 'Mango-season-2026',
  };

  it('creates the account with a trimmed name and the password as typed', async () => {
    vi.mocked(staffApi.acceptInvitation).mockResolvedValue({ ok: true, data: { accepted: true } });

    await expect(actions.acceptInvitationAction(IDLE, form(VALID))).resolves.toEqual({
      status: 'accepted',
    });
    expect(staffApi.acceptInvitation).toHaveBeenCalledWith(CALLER, {
      token: 'tok',
      fullName: 'Rahim Uddin',
      password: 'Mango-season-2026',
    });
  });

  it.each([
    [{ token: '' }, 'invalid'],
    [{ fullName: '  ' }, 'nameMissing'],
    [{ password: 'short', confirm: 'short' }, 'passwordShort'],
    [{ confirm: 'Mango-season-2027' }, 'passwordMismatch'],
  ])('refuses %o as %s without calling the API', async (override, error) => {
    await expect(
      actions.acceptInvitationAction(IDLE, form({ ...VALID, ...override })),
    ).resolves.toMatchObject({ status: 'error', error });
    expect(staffApi.acceptInvitation).not.toHaveBeenCalled();
  });

  it.each([
    [404, null, 'invalid'],
    [410, null, 'expired'],
    [409, null, 'accountExists'],
    [400, 'That password is too common. Please choose a different one.', 'passwordCommon'],
    [400, 'fullName must be a string', 'formInvalid'],
    [429, null, 'tooMany'],
    [0, null, 'unavailable'],
  ])('reads a %i refusal (%j) as %s', async (status, message, error) => {
    vi.mocked(staffApi.acceptInvitation).mockResolvedValue({ ok: false, status, message });

    await expect(actions.acceptInvitationAction(IDLE, form(VALID))).resolves.toMatchObject({
      status: 'error',
      error,
    });
  });
});
