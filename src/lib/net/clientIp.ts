import "server-only";

/**
 * Single source of truth for the client IP of an inbound request.
 *
 * Why this exists: the naive `x-forwarded-for.split(",")[0]` reads the FIRST
 * hop of the chain, which is whatever the caller put there. Vercel Proxy
 * appends the real peer address to a client-supplied XFF instead of replacing
 * it, so hop 0 is attacker-controlled on every request. Anything keyed on it
 * (rate-limit buckets, audit rows) can be poisoned or evaded by sending a
 * random `X-Forwarded-For` per request.
 *
 * The trusted value on Vercel is `x-real-ip`, written by the proxy itself.
 * sourceRef: node_modules/@vercel/functions/headers.js, where the official
 * `ipAddress()` helper reads exactly one header, IP_HEADER_NAME = "x-real-ip".
 * We do not import `ipAddress()` directly because callers here hold a
 * `next/headers` ReadonlyHeaders rather than a Request, and because the XFF
 * fallback below keeps non-Vercel runtimes (local dev, self-hosted) working.
 *
 * Called by: checkRateLimit, lib/api/context.extractIpHash, the MCP route.
 * Tables touched: none.
 */

/**
 * Minimal read interface satisfied by both `Request.headers` (Fetch Headers)
 * and the ReadonlyHeaders returned by `await headers()` in next/headers.
 * Same shape @vercel/functions uses for the identical reason.
 */
export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Resolves the client IP from proxy headers, or null when none is present.
 *
 * Resolution order:
 *   1. `x-real-ip`: set by Vercel Proxy from the real TCP peer. Not
 *      forwardable by the caller, so this is the only trustworthy source in
 *      production.
 *   2. Last hop of `x-forwarded-for`: for runtimes without `x-real-ip`. The
 *      LAST entry is the one appended by the nearest proxy; every earlier
 *      entry is caller-supplied and must never be trusted.
 *
 * Returns null when neither header is present. Callers decide what an
 * unidentifiable client means for them (checkRateLimit fails closed, the
 * audit helpers store a null hash).
 */
export function resolveClientIp(headerReader: HeaderReader): string | null {
  const proxyResolvedIp = headerReader.get("x-real-ip");
  if (proxyResolvedIp && proxyResolvedIp.trim()) {
    return proxyResolvedIp.trim();
  }

  const forwardedForChain = headerReader.get("x-forwarded-for");
  if (forwardedForChain) {
    const hops = forwardedForChain
      .split(",")
      .map((hop) => hop.trim())
      .filter((hop) => hop.length > 0);
    if (hops.length > 0) {
      return hops[hops.length - 1];
    }
  }

  return null;
}
