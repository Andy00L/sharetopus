import "server-only";

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { Agent } from "undici";

import { isPrivateOrReservedIp } from "./ipBlocklist";

/**
 * Resolve-validate-pin primitives that close the DNS-rebinding TOCTOU in
 * every server-side fetch of a user-supplied host. The pattern:
 *   1. resolveHostToPublicAddresses() resolves DNS ONCE and rejects any
 *      private/reserved address.
 *   2. buildPinnedAgent() returns an undici dispatcher whose connector is
 *      pinned to the exact validated IP, so the socket cannot re-resolve
 *      to a different (internal) address between check and connect.
 * The original Host header and TLS SNI are preserved because only the DNS
 * step is pinned, not the request target.
 */

export type HostResolution =
  | { ok: true; addresses: { address: string; family: number }[] }
  | { ok: false; reason: "blocked_host" | "dns_failure" | "blocked_ip" };

/**
 * Resolves a hostname (or accepts a literal IP) and validates every
 * returned address against the private/reserved blocklist. Fails closed:
 * a DNS error, an empty result, or any single blocked address rejects the
 * whole host.
 */
export async function resolveHostToPublicAddresses(
  host: string,
): Promise<HostResolution> {
  if (!host || !host.trim()) {
    return { ok: false, reason: "blocked_host" };
  }

  let addresses: { address: string; family: number }[];

  if (isIP(host) !== 0) {
    addresses = [{ address: host, family: isIP(host) }];
  } else {
    try {
      addresses = await dnsLookup(host, { all: true, verbatim: false });
    } catch {
      return { ok: false, reason: "dns_failure" };
    }
    if (addresses.length === 0) {
      return { ok: false, reason: "dns_failure" };
    }
  }

  for (const entry of addresses) {
    if (isPrivateOrReservedIp(entry.address)) {
      return { ok: false, reason: "blocked_ip" };
    }
  }

  return { ok: true, addresses };
}

/**
 * Builds an undici Agent pinned to the first validated address. Every
 * address in the list was already accepted by resolveHostToPublicAddresses,
 * so connecting to the first is safe; pinning stops undici from running its
 * own second DNS resolution (the rebinding window). Pass the returned Agent
 * as the `dispatcher` on the fetch, and call `.close()` when done.
 */
export function buildPinnedAgent(
  addresses: { address: string; family: number }[],
): Agent {
  const primary = addresses[0];
  const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
    callback(null, primary.address, primary.family);
  };
  return new Agent({ connect: { lookup: pinnedLookup } });
}
