import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { StaffSignInForm } from '../../../../components/admin/StaffSignInForm';
import { SIGN_IN_COPY } from '../../../../lib/admin/copy';
import { NEXT_PARAM, safeAdminNext } from '../../../../lib/admin/routes';
import { getStaffUser } from '../../../../lib/admin/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: SIGN_IN_COPY.title };

interface Props {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/** The password step. A staff member who is already signed in goes straight on. */
export default async function StaffSignInPage({ searchParams }: Props) {
  const next = safeAdminNext((await searchParams)?.[NEXT_PARAM]);
  if (await getStaffUser()) {
    redirect(next);
  }
  return <StaffSignInForm next={next} />;
}
