import { AuthConstants } from './auth.constants';

/*
 * Its own module, not a helper inside auth.mapper, because two things need it: the session
 * listing and the audit trail. auth.mapper imports login.service, and login.service imports
 * AuthEventsService — so importing this from the mapper would close a require cycle that Nest
 * resolves as an undefined provider at boot, with unit tests none the wiser because they
 * construct their services by hand.
 */

/** IPv4 dotted-quad, capturing everything up to (not including) the final dot. */
const IPV4_PATTERN = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/;

/** A trailing IPv4 dotted-quad, as embedded in an IPv4-mapped IPv6 address like `::ffff:203.0.113.42`. */
const IPV4_TAIL_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** A single IPv6 hex group: one to four hex digits. */
const IPV6_GROUP_PATTERN = /^[0-9a-fA-F]{1,4}$/;

/** An IPv6 address always has eight 16-bit groups once `::` compression is expanded. */
const GROUPS_IN_IPV6 = 8;

/**
 * The two 16-bit groups an embedded IPv4 dotted-quad expands to — a dotted-quad is always 32
 * bits, so it always stands in for exactly two of the address's eight groups.
 */
const ipv4TailToGroups = (tail: string): string[] => {
  const octets = tail.split('.').map(Number);
  const high = ((octets[0] << 8) | octets[1]).toString(16);
  const low = ((octets[2] << 8) | octets[3]).toString(16);
  return [high, low];
};

/**
 * The `::`-compressed portion of an IPv6 address, expanded to however many zero groups `::`
 * is standing in for. `tailGroupCount` accounts for an embedded IPv4 tail, which supplies its
 * own two groups and so is not part of this expansion. Returns fewer than the needed groups
 * when the address claims more groups than fit in sixteen bits worth of address — `expandIpv6`
 * treats that as invalid rather than trusting a group count that cannot be real.
 */
const expandCompressed = (body: string, tailGroupCount: number): string[] => {
  const [left, right] = body.split('::');
  const leftGroups = left ? left.split(':').filter(Boolean) : [];
  const rightGroups = right ? right.split(':').filter(Boolean) : [];
  const zerosNeeded = GROUPS_IN_IPV6 - tailGroupCount - leftGroups.length - rightGroups.length;

  if (zerosNeeded < 0) {
    return [];
  }

  const zeroGroups: string[] = new Array<string>(zerosNeeded).fill('0');

  return [...leftGroups, ...zeroGroups, ...rightGroups];
};

/**
 * Expands an IPv6 address — with or without `::` compression, with or without an embedded
 * IPv4 tail — to its eight 16-bit groups, so two spellings of the same address (`2001:db8::1`
 * and its fully-written-out form) normalise to the same value before truncation. `null` for
 * anything that is not a well-formed IPv6 address, which `truncateIp` treats the same as any
 * other unclassifiable input: redacted, not emitted.
 */
const expandIpv6 = (ip: string): string[] | null => {
  if ((ip.match(/::/g) ?? []).length > 1) {
    return null;
  }

  const lastColon = ip.lastIndexOf(':');
  const tail = ip.slice(lastColon + 1);
  const hasIpv4Tail = IPV4_TAIL_PATTERN.test(tail);
  const ipv4Groups = hasIpv4Tail ? ipv4TailToGroups(tail) : [];
  const body = hasIpv4Tail ? ip.slice(0, lastColon) : ip;

  const groups = body.includes('::')
    ? expandCompressed(body, ipv4Groups.length)
    : body.split(':').filter(Boolean);
  const allGroups = [...groups, ...ipv4Groups];

  const isWellFormed =
    allGroups.length === GROUPS_IN_IPV6 && allGroups.every((g) => IPV6_GROUP_PATTERN.test(g));

  return isWellFormed ? allGroups : null;
};

/** A hex group rendered without leading zeros, so `0db8` and `db8` — the same value — match. */
const normaliseGroup = (group: string): string => parseInt(group, 16).toString(16);

/**
 * Truncates a stored IP address, so a full address never reaches a client or an audit row.
 *
 * Exported because `AuthEventsService` records the same value in the audit trail: two
 * implementations of "how much of an address may we keep" would eventually disagree, and the
 * looser one would be the one that leaked.
 *
 * IPv4 loses its last octet (replaced with `AuthConstants.IpTruncationSuffix`) — a /24, same
 * as the historic behaviour here. IPv6 keeps only its first
 * `AuthConstants.Ipv6TruncationPrefixGroups` groups (a /64, the conventional subscriber-line
 * privacy boundary — RFC 4291 §2.5.4) and renders the rest as `::`; dropping a single trailing
 * group, as an earlier version of this function did, only removes 16 of 128 bits and still
 * identifies one host, which defeats the point. A value that matches neither shape — including
 * one this process cannot classify — is redacted to `null` rather than risk emitting it
 * unchanged, since the whole point of this function is that a full address never leaves it.
 * `AuthConstants.IpTruncationSuffix` is IPv4-shaped (`.0`) and is never applied on the IPv6
 * path.
 */
export const truncateIp = (ip: string | null): string | null => {
  if (ip === null) {
    return null;
  }

  const ipv4 = IPV4_PATTERN.exec(ip);
  if (ipv4) {
    return `${ipv4[1]}${AuthConstants.IpTruncationSuffix}`;
  }

  if (ip.includes(':')) {
    const groups = expandIpv6(ip);
    if (groups) {
      const prefix = groups
        .slice(0, AuthConstants.Ipv6TruncationPrefixGroups)
        .map(normaliseGroup)
        .join(':');
      return `${prefix}::`;
    }
  }

  return null;
};
