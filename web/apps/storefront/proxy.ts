import createMiddleware from 'next-intl/middleware';
import type { NextRequest } from 'next/server';

import { routing } from './i18n/routing';
import { maintainSession } from './lib/auth/proxySession';

const localeMiddleware = createMiddleware(routing);

/**
 * Every page request: redirect unprefixed paths into a locale (`/` → `/bn`), then make sure the
 * visitor has a device id and, if their access cookie has lapsed, a refreshed session. Cookies
 * set here are visible to the render that follows.
 */
export default async function proxy(request: NextRequest) {
  const response = localeMiddleware(request);
  await maintainSession(request, response);
  return response;
}

export const config = {
  // `api` and `admin` never reach Next in the monolith (src/web/web-route.ts answers them), but
  // `next dev` runs on its own, so they are excluded here too. Paths with a dot are files.
  // Next reads this statically: it must stay a literal.
  matcher: '/((?!api|admin|_next|_vercel|.*\\..*).*)',
};
