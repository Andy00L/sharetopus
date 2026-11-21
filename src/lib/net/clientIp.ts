import "server-only";

export interface HeaderReader {
  get(name: string): string | null;
}

export function resolveClientIp(headerReader: HeaderReader): string | null {
  const proxyResolvedIp = headerReader.get("x-real-ip");
  if (proxyResolvedIp && proxyResolvedIp.trim()) {
    return proxyResolvedIp.trim();
  }

  // The rightmost x-forwarded-for entry is the one the nearest proxy added;
  // earlier entries are whatever the caller sent:
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For
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
