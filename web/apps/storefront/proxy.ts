import createMiddleware from 'next-intl/middleware';
import { type NextRequest, NextResponse } from 'next/server';

import { routing } from './i18n/routing';
import { isAdminPath, maintainStaffSession } from './lib/admin/proxySession';
import { maintainSession } from './lib/auth/proxySession';

const localeMiddleware = createMiddleware(routing);

/**
 * Every page request: redirect unprefixed paths into a locale (`/` → `/bn`), then make sure the
 * visitor has a device id and, if their access cookie has lapsed, a refreshed session. Cookies
 * set here are visible to the render that follows. The staff portal under `/admin` has no
 * locale and its own session cookies.
 */
export default async function proxy(request: NextRequest) {
  if (isAdminPath(request.nextUrl.pathname)) {
    const response = NextResponse.next();
    await maintainStaffSession(request, response);
    return response;
  }
  const response = localeMiddleware(request);
  await maintainSession(request, response);
  return response;
}

export const config = {
  // `api` never reaches Next in the monolith (src/web/web-route.ts answers it), but `next dev`
  // runs on its own, so it is excluded here too. Paths with a dot are files. Next reads this
  // statically: it must stay a literal.
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
