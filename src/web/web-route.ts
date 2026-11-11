import { WebConstants } from './web.constants';

/** Which surface answers a request path. */
export type WebTarget = 'api' | 'admin' | 'next';

/** True when `path` is `base` itself or sits under it as a whole segment (case-sensitive). */
const isUnderSegment = (path: string, base: string): boolean =>
  path === base || path.startsWith(`${base}/`);

/**
 * The fixed resolution order: the API prefix first, then the admin SPA, then Next for
 * everything else. Only a whole `/${apiPrefix}` segment goes to Nest, so `/apiary` and
 * `/API/v1/x` are Next's to answer. Versioning lives under the prefix, so `/api/v2/x` is
 * still Nest's (and Nest answers 404 JSON).
 */
export const resolveWebTarget = (path: string, apiPrefix: string): WebTarget => {
  if (isUnderSegment(path, `/${apiPrefix}`)) {
    return 'api';
  }
  if (isUnderSegment(path, WebConstants.AdminBasePath)) {
    return 'admin';
  }
  return 'next';
};
