// What the API should know about the browser behind a server-side call. The storefront reaches
// the API over loopback, so without these the API would see the Next server as every visitor:
// one user agent and the address 127.0.0.1, shared by all shoppers' rate limits and sessions.

const USER_AGENT_HEADER = 'user-agent';
const FORWARDED_FOR_HEADER = 'x-forwarded-for';

/** The longest textual IP address (IPv6 with an embedded IPv4 tail). */
const MAX_IP_LENGTH = 45;
const IP_CHARACTERS = /^[0-9a-fA-F.:]+$/;

/** `Headers`, or anything with its `get`. */
export interface HeaderSource {
  get(name: string): string | null;
}

export interface BrowserContext {
  userAgent: string | null;
  clientIp?: string;
}

/**
 * The visitor's address as the edge proxy reported it: the last `X-Forwarded-For` entry, which
 * nginx writes itself (it replaces whatever the browser sent). `null` when absent or not an
 * IP, so a malformed header is dropped instead of forwarded.
 */
export const clientIpOf = (incoming: HeaderSource): string | null => {
  const last = incoming.get(FORWARDED_FOR_HEADER)?.split(',').at(-1)?.trim() ?? '';
  return last.length <= MAX_IP_LENGTH && IP_CHARACTERS.test(last) ? last : null;
};

/** The user agent and, when known, the client address, for a `CallerContext`. */
export const browserOf = (incoming: HeaderSource): BrowserContext => {
  const clientIp = clientIpOf(incoming);
  return { userAgent: incoming.get(USER_AGENT_HEADER), ...(clientIp ? { clientIp } : {}) };
};
