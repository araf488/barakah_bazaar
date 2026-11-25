'use client';

import type { ReactNode } from 'react';

import { Link, usePathname } from '../../i18n/navigation';

/** A primary-nav link that marks itself as the current page. */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const current = usePathname() === href;

  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium whitespace-nowrap text-subtle transition-colors hover:bg-warm hover:text-brand active:bg-border aria-[current=page]:bg-warm aria-[current=page]:text-brand"
    >
      {children}
    </Link>
  );
}
