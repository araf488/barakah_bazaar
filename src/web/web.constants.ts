/**
 * Fixed values for the web mount: the storefront (Next.js) and the admin SPA served from the
 * same process as the API. See docs/superpowers/specs/2026-11-10-monolith-merge-design.md §4.
 */
export const WebConstants = {
  /** URL path the admin SPA is served under. Matches the admin's Vite `base: '/admin/'`. */
  AdminBasePath: '/admin',
  /** Sub-path of the admin build holding Vite's content-hashed bundles. */
  AdminAssetsSegment: 'assets',
  /** The admin SPA shell, served for every extension-less admin path. */
  AdminIndexFileName: 'index.html',
  /**
   * One year, in milliseconds — Vite content-hashes every file under assets/, so a changed
   * file always gets a new URL and the old one may be cached for good.
   */
  AdminAssetMaxAgeMs: 31_536_000_000,
  /** `Cache-Control` for index.html: always revalidate, so a deploy is picked up on refresh. */
  NoCacheDirective: 'no-cache',
  /** Response header name for the directive above. */
  CacheControlHeader: 'Cache-Control',
  /** Content type of the plain-text 404/500 bodies the mount writes itself. */
  PlainTextContentType: 'text/plain',
  /** Content type of the admin SPA shell (index.html) the mount answers from memory. */
  HtmlContentType: 'text/html',
  /** Encoding the admin SPA shell is read with at startup. */
  AdminIndexEncoding: 'utf8',
  /** Next's production build output directory, relative to the storefront app. */
  NextBuildDirName: '.next',
  /** The storefront app, relative to the repository root. */
  StorefrontRelativeDir: 'web/apps/storefront',
  /** The admin SPA's Vite build output, relative to the repository root. */
  AdminDistRelativeDir: 'web/apps/admin/dist',
  /**
   * Environment variable the storefront's server-side fetches read for the API base URL. Set
   * from the validated config before Next is prepared.
   */
  InternalApiBaseUrlEnvKey: 'WEB_INTERNAL_API_BASE_URL',
  /** Logger context for the mount. */
  LoggerContext: 'WebMount',
} as const;

export const WebMessages = {
  /**
   * Startup failure when WEB_ENABLED=true and a build output is absent. {0} = the missing path.
   * The process refuses to start rather than serve half a site.
   */
  BuildMissingTemplate:
    'WEB_ENABLED=true but the web build output is missing: {0}. Run "npm run web:build" before starting.',
  /** Body of a 404 the mount answers itself (an admin path with an extension and no file). */
  NotFound: 'Not Found',
  /** Body of a 500 the mount answers itself (the web request handler threw). */
  InternalServerError: 'Internal Server Error',
} as const;
