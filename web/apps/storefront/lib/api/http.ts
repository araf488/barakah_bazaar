const JSON_MEDIA_TYPE = 'application/json';

/** Message template for a non-2xx answer; the status and path are what a log needs. */
export const API_REQUEST_FAILED_MESSAGE_TEMPLATE = 'API request failed with {status}: {path}';

/** A non-2xx answer from the API, carrying the status so callers can branch on it. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(
      API_REQUEST_FAILED_MESSAGE_TEMPLATE.replace('{status}', String(status)).replace(
        '{path}',
        path,
      ),
    );
    this.name = 'ApiRequestError';
  }
}

/** Next's fetch extension: how long a server-side answer may be reused. */
type NextFetchInit = RequestInit & { next?: { revalidate?: number | false } };

/** GETs JSON, throwing {@link ApiRequestError} on any non-2xx status. */
export const getJson = async <T>(url: string, init: NextFetchInit = {}): Promise<T> => {
  const res = await fetch(url, {
    ...init,
    headers: { Accept: JSON_MEDIA_TYPE, ...init.headers },
  });
  if (!res.ok) {
    throw new ApiRequestError(res.status, url);
  }
  return (await res.json()) as T;
};
