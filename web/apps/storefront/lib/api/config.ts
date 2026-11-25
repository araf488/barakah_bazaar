/** The monolith's own port, used when the server-side env does not name the API. */
const LOCAL_API_BASE_URL = 'http://127.0.0.1:3000/api/v1';

/** In the deployed image the storefront and the API share one origin. */
const SAME_ORIGIN_API_BASE_URL = '/api/v1';

/** Where server components call the API: in-process loopback in the monolith. */
export const serverApiBaseUrl = (): string =>
  process.env.WEB_INTERNAL_API_BASE_URL ?? LOCAL_API_BASE_URL;

/**
 * Where the browser calls the API. Unset in the image (same origin); set by `next dev`, which
 * runs on its own port, to the local API's absolute URL.
 */
export const browserApiBaseUrl = (): string =>
  process.env.NEXT_PUBLIC_API_BASE_URL ?? SAME_ORIGIN_API_BASE_URL;
