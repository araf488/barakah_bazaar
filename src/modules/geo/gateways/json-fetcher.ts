/**
 * The one HTTP call shape the geocoding adapters need.
 *
 * Injected rather than calling `fetch` directly so unit tests can supply a stub — no
 * adapter test may touch the network, and a free public service should not be hit by CI.
 */
export type JsonFetcher = (url: string) => Promise<unknown>;

/** Milliseconds before a geocoder call is abandoned. A slow map search is a failed one. */
export const GEOCODING_TIMEOUT_MS = 5_000;

/**
 * Default fetcher: times out, and throws on a non-2xx so the adapter's catch turns it into
 * the `null` the port defines as "the call failed".
 */
export const fetchJson: JsonFetcher = async (url: string): Promise<unknown> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(GEOCODING_TIMEOUT_MS) });

  if (!response.ok) {
    throw new Error(`geocoder responded ${response.status}`);
  }

  return await response.json();
};
