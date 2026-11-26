import type { ReactNode } from 'react';

import { AdminShell } from '../../../components/admin/AdminShell';
import { getStaffUser } from '../../../lib/admin/session';

/**
 * Wraps every signed-in page in the shell. Without a staff session it draws nothing around the
 * page, whose own `requireStaff` sends the visitor to sign-in and back to that exact page.
 */
export default async function PortalLayout({ children }: { children: ReactNode }) {
  const user = await getStaffUser();
  return user ? <AdminShell user={user}>{children}</AdminShell> : children;
}
