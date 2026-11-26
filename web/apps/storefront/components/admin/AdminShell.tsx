import { LogOut, Menu } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { staffSignOutAction } from '../../lib/admin/actions';
import { SHELL_COPY } from '../../lib/admin/copy';
import { ROLE_LABELS, sectionsFor } from '../../lib/admin/roles';
import { ADMIN_ROUTES } from '../../lib/admin/routes';
import type { StaffUser } from '../../lib/admin/session';
import { BrandMark } from '../shell/BrandMark';
import { AdminNav } from './AdminNav';

const MAIN_ID = 'admin-main';

/** Name first, the email's local part when there is no name. */
export const displayNameOf = (user: StaffUser): string =>
  user.fullName?.trim() || user.email.split('@')[0] || user.email;

function SignOut() {
  return (
    <form action={staffSignOutAction}>
      <button
        type="submit"
        className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-gold"
      >
        <LogOut aria-hidden="true" size={18} />
        {SHELL_COPY.signOut}
      </button>
    </form>
  );
}

function Who({ user }: { user: StaffUser }) {
  return (
    <div className="px-3 py-2">
      <p className="truncate text-sm font-semibold text-white">{displayNameOf(user)}</p>
      <p className="truncate text-xs text-gold">{ROLE_LABELS[user.role]}</p>
    </div>
  );
}

function Brand() {
  return (
    <Link
      href={ADMIN_ROUTES.home}
      aria-label={SHELL_COPY.homeLink}
      className="flex min-h-11 items-center gap-3 rounded-xl focus-visible:outline-gold"
    >
      <BrandMark tone="onDark" />
    </Link>
  );
}

/**
 * The signed-in portal: a dark green sidebar on wide screens (sections for this role, who is
 * signed in, sign out), and a menu that folds open on narrower ones. Pages render in `main`.
 */
export function AdminShell({ user, children }: { user: StaffUser; children: ReactNode }) {
  const sections = sectionsFor(user.role);

  return (
    <div className="min-h-screen lg:flex">
      <a
        href={`#${MAIN_ID}`}
        className="sr-only z-50 rounded-full bg-brand px-4 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:inline-flex focus:min-h-11 focus:items-center"
      >
        {SHELL_COPY.skipToContent}
      </a>
      <aside className="hidden w-60 shrink-0 flex-col bg-brand-dark lg:sticky lg:top-0 lg:flex lg:h-screen">
        <div className="flex h-16 items-center border-b border-white/10 px-4">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <AdminNav sections={sections} label={SHELL_COPY.nav} />
        </div>
        <div className="space-y-1 border-t border-white/10 p-3">
          <Who user={user} />
          <SignOut />
        </div>
      </aside>
      <details className="group bg-brand-dark lg:hidden">
        <summary className="flex min-h-16 list-none items-center justify-between gap-3 px-4 [&::-webkit-details-marker]:hidden">
          <Brand />
          <span className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-white">
            <Menu aria-hidden="true" size={18} />
            {SHELL_COPY.menu}
          </span>
        </summary>
        <div className="space-y-3 border-t border-white/10 px-3 py-3">
          <AdminNav sections={sections} label={SHELL_COPY.nav} />
          <div className="border-t border-white/10 pt-2">
            <Who user={user} />
            <SignOut />
          </div>
        </div>
      </details>
      <main id={MAIN_ID} tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
        {children}
      </main>
    </div>
  );
}
