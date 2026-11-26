import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeJar } from '../../../test/cookieJar';

const jar = { current: fakeJar() };
const REDIRECTED = new Error('NEXT_REDIRECT');
const NOT_FOUND = new Error('NEXT_NOT_FOUND');

vi.mock('next/headers', () => ({
  cookies: async () => jar.current,
  headers: async () => new Headers({ 'user-agent': 'UA' }),
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw REDIRECTED;
  }),
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));
vi.mock('../../auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/api')>()),
  authApi: { me: vi.fn() },
}));

const { getStaffUser, requireStaff, staffCaller } = await import('../session');
const { authApi } = await import('../../auth/api');
const { redirect } = await import('next/navigation');

const user = (role: string) => ({
  id: 'u1',
  email: 'ops@barakah.test',
  fullName: 'Rahim Uddin',
  phoneVerified: false,
  role,
  createdAt: '2026-11-01',
});

beforeEach(() => {
  vi.clearAllMocks();
  jar.current = fakeJar({
    bb_device: 'device-1',
    bb_staff_session: 'staff-at',
    bb_session: 'shop-at',
  });
});

describe('staffCaller', () => {
  it('uses the staff token, never the shop’s', async () => {
    await expect(staffCaller()).resolves.toEqual({
      deviceId: 'device-1',
      accessToken: 'staff-at',
      userAgent: 'UA',
    });
  });

  it('is null without a staff token or a device id', async () => {
    jar.current = fakeJar({ bb_device: 'device-1', bb_session: 'shop-at' });
    await expect(staffCaller()).resolves.toBeNull();
    jar.current = fakeJar({ bb_staff_session: 'staff-at' });
    await expect(staffCaller()).resolves.toBeNull();
  });
});

describe('getStaffUser', () => {
  it('answers the staff member the API reports', async () => {
    vi.mocked(authApi.me).mockResolvedValue({ ok: true, data: user('OPS') });

    await expect(getStaffUser()).resolves.toMatchObject({ role: 'OPS' });
    expect(authApi.me).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'staff-at' }));
  });

  it('treats a customer, or a refused call, as nobody', async () => {
    vi.mocked(authApi.me).mockResolvedValue({ ok: true, data: user('CUSTOMER') });
    await expect(getStaffUser()).resolves.toBeNull();

    vi.mocked(authApi.me).mockResolvedValue({ ok: false, status: 401 });
    await expect(getStaffUser()).resolves.toBeNull();
  });
});

describe('requireStaff', () => {
  it('sends a visitor without a staff session to sign in, and back to the page', async () => {
    jar.current = fakeJar({ bb_device: 'device-1' });

    await expect(requireStaff('/admin/orders')).rejects.toBe(REDIRECTED);

    expect(redirect).toHaveBeenCalledWith('/admin/sign-in?next=%2Fadmin%2Forders');
  });

  it('answers 404 to a role the page is not for', async () => {
    vi.mocked(authApi.me).mockResolvedValue({ ok: true, data: user('MARKETING') });

    await expect(requireStaff('/admin/orders', ['SUPER_ADMIN', 'OPS'])).rejects.toBe(NOT_FOUND);
  });

  it('lets an allowed role through', async () => {
    vi.mocked(authApi.me).mockResolvedValue({ ok: true, data: user('OPS') });

    await expect(requireStaff('/admin/orders', ['SUPER_ADMIN', 'OPS'])).resolves.toMatchObject({
      role: 'OPS',
    });
  });
});
