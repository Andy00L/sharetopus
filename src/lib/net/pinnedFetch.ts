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
 *   2. acquirePinnedDispatcher() returns an undici dispatcher whose
 *      connector is pinned to the exact validated IP, so the socket cannot
 *      re-resolve to a different (internal) address between check and
 *      connect.
 * The original Host header and TLS SNI are preserved because only the DNS
 * step is pinned, not the request target.
 */

export type PinnedAddress = { address: string; family: number };

export type ValidatedAddresses = [PinnedAddress, ...PinnedAddress[]];

export type HostResolution =
  | { ok: true; addresses: ValidatedAddresses }
  | { ok: false; reason: "blocked_host" | "dns_failure" | "blocked_ip" };

/** Distinct pinned IPs whose dispatchers stay cached for connection reuse. */
const PINNED_DISPATCHER_CACHE_LIMIT = 64;

const pinnedDispatchersByAddress = new Map<string, Agent>();

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

  let resolvedAddresses: PinnedAddress[];

  if (isIP(host) !== 0) {
    resolvedAddresses = [{ address: host, family: isIP(host) }];
  } else {
    try {
      resolvedAddresses = await dnsLookup(host, { all: true, verbatim: false });
    } catch {
      return { ok: false, reason: "dns_failure" };
    }
  }

  const [firstAddress, ...otherAddresses] = resolvedAddresses;
  if (!firstAddress) {
    return { ok: false, reason: "dns_failure" };
  }

  for (const entry of resolvedAddresses) {
    if (isPrivateOrReservedIp(entry.address)) {
      return { ok: false, reason: "blocked_ip" };
    }
  }

  return { ok: true, addresses: [firstAddress, ...otherAddresses] };
}

/**
 * A lookup that answers every resolution with the one validated address.
 * Node's net.connect calls the lookup with { all: true } whenever
 * autoSelectFamily is on (the default since Node 20) and rejects a
 * single-address answer with ERR_INVALID_IP_ADDRESS, so the answer must
 * follow the requested shape. sourceRef: node lib/net.js,
 * lookupAndConnectMultiple.
 */
export function buildPinnedLookup(pinnedAddress: PinnedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address: pinnedAddress.address, family: pinnedAddress.family }]);
      return;
    }
    callback(null, pinnedAddress.address, pinnedAddress.family);
  };
}

/**
 * Builds a fresh undici Agent pinned to the first validated address. The
 * caller owns it and calls `.close()` when done. Prefer
 * acquirePinnedDispatcher, which reuses connections across requests.
 */
export function buildPinnedAgent(addresses: ValidatedAddresses): Agent {
  return new Agent({ connect: { lookup: buildPinnedLookup(addresses[0]) } });
}

/**
 * Returns the process-wide dispatcher pinned to the first validated
 * address, creating it on first use. One dispatcher per pinned IP lets
 * keep-alive sockets serve the next request to the same origin (undici
 * pools sockets per origin inside an Agent, so a socket opened for one
 * hostname never serves another). Never close the returned dispatcher.
 *
 * Reuse stays pinned: every request re-resolves and re-validates its host
 * first, and only a resolution whose first address is this IP gets this
 * dispatcher. The least recently used entry is dropped past the cache
 * limit without closing it, so a request still using it finishes; its idle
 * sockets expire on undici's keep-alive timeout.
 */
export function acquirePinnedDispatcher(addresses: ValidatedAddresses): Agent {
  const pinnedAddress = addresses[0];
  const cacheKey = `${pinnedAddress.family}/${pinnedAddress.address}`;

  const cachedDispatcher = pinnedDispatchersByAddress.get(cacheKey);
  if (cachedDispatcher) {
    pinnedDispatchersByAddress.delete(cacheKey);
    pinnedDispatchersByAddress.set(cacheKey, cachedDispatcher);
    return cachedDispatcher;
  }

  const pinnedDispatcher = buildPinnedAgent(addresses);
  pinnedDispatchersByAddress.set(cacheKey, pinnedDispatcher);

  if (pinnedDispatchersByAddress.size > PINNED_DISPATCHER_CACHE_LIMIT) {
    const leastRecentKey = pinnedDispatchersByAddress.keys().next().value;
    if (leastRecentKey !== undefined) {
      pinnedDispatchersByAddress.delete(leastRecentKey);
    }
  }

  return pinnedDispatcher;
}
