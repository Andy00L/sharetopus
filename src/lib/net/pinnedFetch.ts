import "server-only";

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { Agent } from "undici";

import { isPrivateOrReservedIp } from "./ipBlocklist";

export type PinnedAddress = { address: string; family: number };

export type ValidatedAddresses = [PinnedAddress, ...PinnedAddress[]];

export type HostResolution =
  | { ok: true; addresses: ValidatedAddresses }
  | { ok: false; reason: "blocked_host" | "dns_failure" | "blocked_ip" };

const PINNED_DISPATCHER_CACHE_LIMIT = 64;

class SharedPinnedDispatcher extends Agent {
  declare readonly close: never;
  declare readonly destroy: never;
}

const pinnedDispatchersByAddress = new Map<string, SharedPinnedDispatcher>();

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
 * undici pools sockets per origin inside an Agent, so one dispatcher per
 * pinned IP never lets a socket opened for one hostname serve another.
 * An evicted entry is dropped without closing it: a request still using it
 * finishes, and its idle sockets expire on undici's keep-alive timeout.
 * sourceRef: node_modules/undici/lib/dispatcher/agent.js (clients keyed by
 * origin), node_modules/undici/lib/dispatcher/client.js (keepAliveTimeout).
 */
export function acquirePinnedDispatcher(
  addresses: ValidatedAddresses,
): SharedPinnedDispatcher {
  const pinnedAddress = addresses[0];
  const cacheKey = `${pinnedAddress.family}/${pinnedAddress.address}`;

  const cachedDispatcher = pinnedDispatchersByAddress.get(cacheKey);
  if (cachedDispatcher) {
    pinnedDispatchersByAddress.delete(cacheKey);
    pinnedDispatchersByAddress.set(cacheKey, cachedDispatcher);
    return cachedDispatcher;
  }

  const pinnedDispatcher = new SharedPinnedDispatcher({
    connect: { lookup: buildPinnedLookup(pinnedAddress) },
  });
  pinnedDispatchersByAddress.set(cacheKey, pinnedDispatcher);

  if (pinnedDispatchersByAddress.size > PINNED_DISPATCHER_CACHE_LIMIT) {
    const leastRecentKey = pinnedDispatchersByAddress.keys().next().value;
    if (leastRecentKey !== undefined) {
      pinnedDispatchersByAddress.delete(leastRecentKey);
    }
  }

  return pinnedDispatcher;
}
