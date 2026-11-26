import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { MfaSetup } from '../../../../../components/admin/MfaSetup';
import { readStaffChallenge, STAFF_COOKIE } from '../../../../../lib/admin/cookies';
import { SETUP_COPY } from '../../../../../lib/admin/copy';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: SETUP_COPY.title };

/**
 * Authenticator setup, for a sign-in that asked for it. Without a pending enrolment the page
 * still renders the same component rather than redirecting: confirming setup ends the
 * enrolment, and the page drawn again after that must keep the recovery codes on screen.
 */
export default async function StaffSetupPage() {
  const challenge = (await cookies()).get(STAFF_COOKIE.challenge)?.value;
  return <MfaSetup active={readStaffChallenge(challenge, 'enrolment') !== null} />;
}
