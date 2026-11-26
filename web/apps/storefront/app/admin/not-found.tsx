import Link from 'next/link';

import { NOT_FOUND_COPY } from '../../lib/admin/copy';
import { ADMIN_ROUTES } from '../../lib/admin/routes';

/** Unknown admin paths, and pages the staff member's role may not open. */
export default function AdminNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-3xl font-semibold text-ink">{NOT_FOUND_COPY.title}</h1>
        <p className="mt-2 text-subtle">{NOT_FOUND_COPY.body}</p>
        <Link
          href={ADMIN_ROUTES.home}
          className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-brand px-5 text-sm font-semibold text-white transition hover:bg-brand-light"
        >
          {NOT_FOUND_COPY.back}
        </Link>
      </div>
    </main>
  );
}
