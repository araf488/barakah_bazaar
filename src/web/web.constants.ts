/**
 * Fixed values for the web mount: the storefront (Next.js, which also serves /admin) served from the
 * same process as the API. See docs/superpowers/specs/2026-11-10-monolith-merge-design.md §4.
 */
export const WebConstants = {
  /** Content type of the plain-text 404/500 bodies the mount writes itself. */
  PlainTextContentType: 'text/plain',
  /** Next's production build output directory, relative to the storefront app. */
  NextBuildDirName: '.next',
  /** The storefront app, relative to the repository root. */
  StorefrontRelativeDir: 'web/apps/storefront',
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
  /** Body of a 500 the mount answers itself (the web request handler threw). */
  InternalServerError: 'Internal Server Error',
} as const;
