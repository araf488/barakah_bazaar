import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeJar } from '../../../test/cookieJar';

const jar = { current: fakeJar() };
const REDIRECTED = new Error('NEXT_REDIRECT');

vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => jar.current }));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'bn') }));
vi.mock('../../../i18n/navigation', () => ({
  redirect: vi.fn(() => {
    throw REDIRECTED;
  }),
}));
vi.mock('../caller', () => ({ accountCaller: vi.fn() }));
vi.mock('../security', () => ({
  securityApi: {
    changePassword: vi.fn(),
    endSession: vi.fn(),
    endAllSessions: vi.fn(),
  },
}));

const { changePasswordAction, endSessionAction, endAllSessionsAction } =
  await import('../securityActions');
const { accountCaller } = await import('../caller');
const { securityApi } = await import('../security');
const { refresh } = await import('next/cache');
const { redirect } = await import('../../../i18n/navigation');

const CALLER = { deviceId: 'd', accessToken: 'at' };
const IDLE = { status: 'idle' } as const;
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const PASSWORDS = {
  currentPassword: ' Old-password-1 ',
  newPassword: 'Mango-season-2026 ',
  confirmPassword: 'Mango-season-2026 ',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(accountCaller).mockResolvedValue(CALLER);
  jar.current = fakeJar({ bb_device: 'd', bb_session: 'at', bb_refresh: 'rt' });
});

describe('changePasswordAction', () => {
  it('sends both passwords untrimmed and redraws the page', async () => {
    vi.mocked(securityApi.changePassword).mockResolvedValue({ ok: true, data: undefined });

    const state = await changePasswordAction(IDLE, form(PASSWORDS));

    expect(state.status).toBe('changed');
    expect(securityApi.changePassword).toHaveBeenCalledWith(CALLER, {
      currentPassword: ' Old-password-1 ',
      newPassword: 'Mango-season-2026 ',
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('stops at a form error without calling the API', async () => {
    const state = await changePasswordAction(
      IDLE,
      form({ ...PASSWORDS, confirmPassword: 'something else' }),
    );

    expect(state).toMatchObject({ status: 'error', error: 'passwordMismatch' });
    expect(securityApi.changePassword).not.toHaveBeenCalled();
  });

  it('says the session ended when there is no access cookie', async () => {
    vi.mocked(accountCaller).mockResolvedValue(null);

    const state = await changePasswordAction(IDLE, form(PASSWORDS));

    expect(state).toMatchObject({ status: 'error', error: 'signedOut' });
    expect(securityApi.changePassword).not.toHaveBeenCalled();
  });

  it('names a wrong current password', async () => {
    vi.mocked(securityApi.changePassword).mockResolvedValue({
      ok: false,
      status: 401,
      message: 'Those sign-in details are not correct.',
    });

    const state = await changePasswordAction(IDLE, form(PASSWORDS));

    expect(state).toMatchObject({ status: 'error', error: 'currentWrong' });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('names the policy rule a new password broke', async () => {
    vi.mocked(securityApi.changePassword).mockResolvedValue({
      ok: false,
      status: 400,
      message: 'That password is too common. Please choose a different one.',
    });

    const state = await changePasswordAction(IDLE, form(PASSWORDS));

    expect(state).toMatchObject({ status: 'error', error: 'passwordCommon' });
  });

  it('reports an unreachable API as a failure', async () => {
    vi.mocked(securityApi.changePassword).mockResolvedValue({
      ok: false,
      status: 0,
      message: null,
    });

    const state = await changePasswordAction(IDLE, form(PASSWORDS));

    expect(state).toMatchObject({ status: 'error', error: 'failed' });
  });
});

describe('endSessionAction', () => {
  it('ends the named session and redraws the list', async () => {
    vi.mocked(securityApi.endSession).mockResolvedValue({ ok: true, data: undefined });

    await expect(endSessionAction(IDLE, form({ id: 's2' }))).resolves.toEqual(IDLE);

    expect(securityApi.endSession).toHaveBeenCalledWith(CALLER, 's2');
    expect(refresh).toHaveBeenCalled();
  });

  it('treats a session that has already gone as done', async () => {
    vi.mocked(securityApi.endSession).mockResolvedValue({ ok: false, status: 404 });

    await expect(endSessionAction(IDLE, form({ id: 's2' }))).resolves.toEqual(IDLE);
    expect(refresh).toHaveBeenCalled();
  });

  it('says so when the API refuses', async () => {
    vi.mocked(securityApi.endSession).mockResolvedValue({ ok: false, status: 503 });

    const state = await endSessionAction(IDLE, form({ id: 's2' }));

    expect(state).toMatchObject({ status: 'error', error: 'failed' });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('says the session ended on a 401', async () => {
    vi.mocked(securityApi.endSession).mockResolvedValue({ ok: false, status: 401 });
    const state = await endSessionAction(IDLE, form({ id: 's2' }));
    expect(state).toMatchObject({ status: 'error', error: 'signedOut' });
  });

  it('asks the API nothing without an id', async () => {
    await expect(endSessionAction(IDLE, form({}))).resolves.toEqual(IDLE);
    expect(securityApi.endSession).not.toHaveBeenCalled();
  });

  it('says the session ended when there is no access cookie', async () => {
    vi.mocked(accountCaller).mockResolvedValue(null);
    const state = await endSessionAction(IDLE, form({ id: 's2' }));
    expect(state).toMatchObject({ status: 'error', error: 'signedOut' });
    expect(securityApi.endSession).not.toHaveBeenCalled();
  });
});

describe('endAllSessionsAction', () => {
  it('ends every session, clears the cookies and sends the visitor to sign in', async () => {
    vi.mocked(securityApi.endAllSessions).mockResolvedValue({ ok: true, data: { revoked: 3 } });

    await expect(endAllSessionsAction()).rejects.toBe(REDIRECTED);

    expect(securityApi.endAllSessions).toHaveBeenCalledWith(CALLER);
    expect([...jar.current.values.keys()]).toEqual(['bb_device']);
    expect(redirect).toHaveBeenCalledWith({
      href: { pathname: '/sign-in', query: { next: '/account/security' } },
      locale: 'bn',
    });
  });

  it('signs out here too when this session had already ended', async () => {
    vi.mocked(securityApi.endAllSessions).mockResolvedValue({ ok: false, status: 401 });

    await expect(endAllSessionsAction()).rejects.toBe(REDIRECTED);
    expect(jar.current.values.has('bb_session')).toBe(false);
  });

  it('keeps the visitor signed in and says so when the API fails', async () => {
    vi.mocked(securityApi.endAllSessions).mockResolvedValue({ ok: false, status: 0 });

    const state = await endAllSessionsAction();

    expect(state).toMatchObject({ status: 'error', error: 'failed' });
    expect(jar.current.values.has('bb_session')).toBe(true);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('says the session ended when there is no access cookie', async () => {
    vi.mocked(accountCaller).mockResolvedValue(null);
    const state = await endAllSessionsAction();
    expect(state).toMatchObject({ status: 'error', error: 'signedOut' });
    expect(securityApi.endAllSessions).not.toHaveBeenCalled();
  });
});
