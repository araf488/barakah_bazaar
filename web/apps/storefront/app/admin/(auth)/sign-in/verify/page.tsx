import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { StaffCodeForm } from '../../../../../components/admin/StaffCodeForm';
import { readStaffChallenge, STAFF_COOKIE } from '../../../../../lib/admin/cookies';
import { VERIFY_COPY } from '../../../../../lib/admin/copy';
import { ADMIN_ROUTES, NEXT_PARAM, safeAdminNext } from '../../../../../lib/admin/routes';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: VERIFY_COPY.title };

interface Props {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/** The code step. Without a pending challenge (it lives five minutes) it is back to the password. */
export default async function StaffVerifyPage({ searchParams }: Props) {
  const challenge = (await cookies()).get(STAFF_COOKIE.challenge)?.value;
  if (!readStaffChallenge(challenge, 'mfa')) {
    redirect(ADMIN_ROUTES.signIn);
  }
  return <StaffCodeForm next={safeAdminNext((await searchParams)?.[NEXT_PARAM])} />;
}
