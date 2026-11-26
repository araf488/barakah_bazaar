import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';

import { type AuthUser, authApi, type CallerContext } from '../auth/api';
import { browserOf } from '../auth/browser';
import { SESSION_COOKIE } from '../auth/cookies';
import { STAFF_COOKIE } from './cookies';
import { isStaffRole, type StaffRole } from './roles';
import { signInPathFor } from './routes';

export type StaffUser = AuthUser & { role: StaffRole };

/** The caller for a staff API call, or `null` without a staff access cookie. */
export const staffCaller = async (): Promise<CallerContext | null> => {
  const [jar, incoming] = await Promise.all([cookies(), headers()]);
  const accessToken = jar.get(STAFF_COOKIE.access)?.value;
  const deviceId = jar.get(SESSION_COOKIE.device)?.value;
  if (!accessToken || !deviceId) {
    return null;
  }
  return { deviceId, accessToken, ...browserOf(incoming) };
};

/**
 * The signed-in staff member for this render, or `null`. The role comes from the API, which
 * reads it from the database on every call; a customer's token here is treated as no session.
 */
export const getStaffUser = cache(async (): Promise<StaffUser | null> => {
  const caller = await staffCaller();
  if (!caller) {
    return null;
  }
  const result = await authApi.me(caller);
  if (!result.ok || !isStaffRole(result.data.role)) {
    return null;
  }
  return result.data as StaffUser;
});

/**
 * Every admin page's gate: a visitor without a staff session goes to sign-in and comes back to
 * `path`; a staff member whose role may not open the page gets a 404, as if it were not there.
 */
export const requireStaff = async (
  path: string,
  roles?: readonly StaffRole[],
): Promise<StaffUser> => {
  const user = await getStaffUser();
  if (!user) {
    redirect(signInPathFor(path));
  }
  if (roles && !roles.includes(user.role)) {
    notFound();
  }
  return user;
};
