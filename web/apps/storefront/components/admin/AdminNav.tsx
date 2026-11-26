'use client';

import { LayoutDashboard, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { AdminSection, AdminSectionKey } from '../../lib/admin/roles';
import { ADMIN_ROUTES } from '../../lib/admin/routes';

const ICONS: Readonly<Record<AdminSectionKey, LucideIcon>> = {
  overview: LayoutDashboard,
};

/** The overview matches only itself; every other section also owns the pages beneath it. */
const isCurrent = (path: string, pathname: string): boolean =>
  path === ADMIN_ROUTES.home
    ? pathname === path
    : pathname === path || pathname.startsWith(`${path}/`);

/** The sections this staff member may open, the current one marked for screen readers too. */
export function AdminNav({ sections, label }: { sections: AdminSection[]; label: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label={label}>
      <ul className="space-y-1">
        {sections.map((section) => {
          const Icon = ICONS[section.key];
          const current = isCurrent(section.path, pathname);
          return (
            <li key={section.key}>
              <Link
                href={section.path}
                aria-current={current ? 'page' : undefined}
                className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:outline-gold ${
                  current
                    ? 'bg-brand text-white'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon aria-hidden="true" size={18} className="shrink-0" />
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
