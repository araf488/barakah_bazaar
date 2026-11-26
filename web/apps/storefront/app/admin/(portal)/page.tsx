import type { Metadata } from 'next';

import { displayNameOf } from '../../../components/admin/AdminShell';
import { OVERVIEW_COPY } from '../../../lib/admin/copy';
import { ROLE_LABELS } from '../../../lib/admin/roles';
import { ADMIN_ROUTES } from '../../../lib/admin/routes';
import { requireStaff } from '../../../lib/admin/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: OVERVIEW_COPY.title };

/** The landing page after sign-in: who is signed in, and with which role. */
export default async function AdminOverviewPage() {
  const user = await requireStaff(ADMIN_ROUTES.home);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <p className="text-sm font-semibold text-subtle">{OVERVIEW_COPY.title}</p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-ink">
          {OVERVIEW_COPY.greeting.replace('{name}', displayNameOf(user))}
        </h1>
      </div>
      <section
        aria-labelledby="account-title"
        className="max-w-md rounded-2xl border border-border bg-white p-5"
      >
        <h2 id="account-title" className="font-display text-xl font-semibold text-ink">
          {OVERVIEW_COPY.account}
        </h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-subtle">{OVERVIEW_COPY.email}</dt>
          <dd className="min-w-0 truncate text-ink">{user.email}</dd>
          <dt className="text-subtle">{OVERVIEW_COPY.role}</dt>
          <dd className="text-ink">{ROLE_LABELS[user.role]}</dd>
        </dl>
      </section>
    </div>
  );
}
