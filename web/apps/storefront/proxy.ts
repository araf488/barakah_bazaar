import createMiddleware from 'next-intl/middleware';

import { routing } from './i18n/routing';

/** Redirects every unprefixed page path into a locale (`/` → `/bn`), honouring a saved choice. */
export default createMiddleware(routing);

export const config = {
  // `api` and `admin` never reach Next in the monolith (src/web/web-route.ts answers them), but
  // `next dev` runs on its own, so they are excluded here too. Paths with a dot are files.
  // Next reads this statically: it must stay a literal.
  matcher: '/((?!api|admin|_next|_vercel|.*\\..*).*)',
};
