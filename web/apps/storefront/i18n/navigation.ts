import { createNavigation } from 'next-intl/navigation';

import { routing } from './routing';

/** Locale-aware drop-ins for Next's `Link`, `redirect`, `usePathname` and `useRouter`. */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
