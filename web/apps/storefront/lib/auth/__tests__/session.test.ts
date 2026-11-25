import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeJar } from '../../../test/cookieJar';

const jar = { current: fakeJar() };
vi.mock('next/headers', () => ({
  cookies: async () => jar.current,
  headers: async () => new Headers({ 'user-agent': 'UA' }),
}));
vi.mock('../api', () => ({ authApi: { me: vi.fn() } }));

const { getCurrentUser } = await import('../session');
const { authApi } = await import('../api');

describe('getCurrentUser', () => {
  beforeEach(() => vi.mocked(authApi.me).mockReset());

  it('is nobody without an access cookie, and asks the API nothing', async () => {
    jar.current = fakeJar({ bb_device: 'd' });
    await expect(getCurrentUser()).resolves.toBeNull();
    expect(authApi.me).not.toHaveBeenCalled();
  });

  it('asks the API who the access token belongs to', async () => {
    jar.current = fakeJar({ bb_device: 'd', bb_session: 'at' });
    vi.mocked(authApi.me).mockResolvedValue({ ok: true, data: { id: 'u1' } as never });

    await expect(getCurrentUser()).resolves.toEqual({ id: 'u1' });
    expect(authApi.me).toHaveBeenCalledWith({ deviceId: 'd', accessToken: 'at', userAgent: 'UA' });
  });

  it('is nobody when the API refuses the token', async () => {
    jar.current = fakeJar({ bb_device: 'd', bb_session: 'stale' });
    vi.mocked(authApi.me).mockResolvedValue({ ok: false, status: 401 });
    await expect(getCurrentUser()).resolves.toBeNull();
  });
});
