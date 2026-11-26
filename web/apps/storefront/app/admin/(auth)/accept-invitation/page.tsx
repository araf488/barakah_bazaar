import type { Metadata } from 'next';

import { AcceptInvitationForm } from '../../../../components/admin/AcceptInvitationForm';
import { INVITATION_COPY } from '../../../../lib/admin/copy';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: INVITATION_COPY.title };

/** The invitation token is the only query parameter; the API checks it when the form is sent. */
const TOKEN_PARAM = 'token';

interface Props {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/** Where a staff invitation email lands. A link without a token cannot become an account. */
export default async function AcceptInvitationPage({ searchParams }: Props) {
  const raw = (await searchParams)?.[TOKEN_PARAM];
  const token = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
  if (!token) {
    return (
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-semibold text-ink">{INVITATION_COPY.title}</h1>
        <p role="alert" className="text-sm text-red-800">
          {INVITATION_COPY.missingToken}
        </p>
      </div>
    );
  }
  return <AcceptInvitationForm token={token} />;
}
