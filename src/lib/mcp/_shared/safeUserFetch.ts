import "server-only";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

// ---------- public types ----------

export type SafeFetchOk = {
  success: true;
  bytes: Buffer;
  contentType: string;
  finalUrl: string;
};

export type SafeFetchErr = {
  success: false;
  message: string;
  reason:
    | "invalid_url"
    | "blocked_scheme"
    | "blocked_host"
    | "blocked_ip"
    | "dns_failure"
    | "redirect_not_allowed"
    | "content_type_not_allowed"
    | "too_large"
    | "timeout"
    | "fetch_failed";
};

export type SafeFetchResult = SafeFetchOk | SafeFetchErr;

export type SafeFetchOptions = {
  maxBytes: number;
  allowedContentTypePrefixes: readonly string[];
  allowedContentTypes: readonly string[];
  connectTimeoutMs: number;
  totalTimeoutMs: number;
};

// ---------- IP blocklist ----------

/**
 * Returns true if the IPv4 address (dotted-decimal) falls in any
 * private, reserved, loopback, link-local, CGNAT, multicast, or
 * broadcast range.
 */
function isPrivateIpv4(addr: string): boolean {
  const parts = addr.split(".");
  const a = Number(parts[0]);
  const b = Number(parts[1]);

  if (a === 0) return true;                         // 0.0.0.0/8
  if (a === 10) return true;                        // 10.0.0.0/8
  if (a === 100 && (b & 0xc0) === 64) return true;  // 100.64.0.0/10 (CGNAT)
  if (a === 127) return true;                       // 127.0.0.0/8
  if (a === 169 && b === 254) return true;          // 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;          // 192.168.0.0/16
  if (a >= 224 && a <= 239) return true;            // 224.0.0.0/4 (multicast)
  if (a >= 240) return true;                        // 240.0.0.0/4 (reserved + broadcast)
  return false;
}

/**
 * Parse an IPv6 address string into a 16-byte Uint8Array.
 * Handles :: expansion and embedded IPv4 suffixes (::ffff:1.2.3.4).
 */
function parseIpv6ToBytes(raw: string): Uint8Array {
  const bytes = new Uint8Array(16);
  let addr = raw;
  let targetGroups = 8;
  let ipv4Bytes: number[] | null = null;

  if (addr.includes(".")) {
    const lastColon = addr.lastIndexOf(":");
    const ipv4Str = addr.substring(lastColon + 1);
    ipv4Bytes = ipv4Str.split(".").map(Number);
    addr = addr.substring(0, lastColon);
    targetGroups = 6;
    if (addr.endsWith(":") && !addr.endsWith("::")) {
      addr = addr.slice(0, -1);
    }
  }

  const halves = addr.split("::");
  const leftTokens = halves[0]
    ? halves[0].split(":").filter(Boolean)
    : [];
  const rightTokens =
    halves.length > 1 && halves[1]
      ? halves[1].split(":").filter(Boolean)
      : [];

  let offset = 0;
  for (const token of leftTokens) {
    const val = parseInt(token, 16);
    bytes[offset] = (val >> 8) & 0xff;
    bytes[offset + 1] = val & 0xff;
    offset += 2;
  }

  const zerosNeeded = targetGroups - leftTokens.length - rightTokens.length;
  offset += zerosNeeded * 2;

  for (const token of rightTokens) {
    const val = parseInt(token, 16);
    bytes[offset] = (val >> 8) & 0xff;
    bytes[offset + 1] = val & 0xff;
    offset += 2;
  }

  if (ipv4Bytes) {
    bytes[12] = ipv4Bytes[0];
    bytes[13] = ipv4Bytes[1];
    bytes[14] = ipv4Bytes[2];
    bytes[15] = ipv4Bytes[3];
  }

  return bytes;
}

/**
 * Returns true if the IPv6 address falls in any blocked range, including
 * IPv4-mapped addresses whose embedded IPv4 is private.
 */
function isPrivateIpv6(addr: string): boolean {
  const b = parseIpv6ToBytes(addr);

  // ::1/128 (loopback)
  if (
    b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 0 &&
    b[4] === 0 && b[5] === 0 && b[6] === 0 && b[7] === 0 &&
    b[8] === 0 && b[9] === 0 && b[10] === 0 && b[11] === 0 &&
    b[12] === 0 && b[13] === 0 && b[14] === 0 && b[15] === 1
  ) {
    return true;
  }

  // ::/128 (unspecified)
  if (
    b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 0 &&
    b[4] === 0 && b[5] === 0 && b[6] === 0 && b[7] === 0 &&
    b[8] === 0 && b[9] === 0 && b[10] === 0 && b[11] === 0 &&
    b[12] === 0 && b[13] === 0 && b[14] === 0 && b[15] === 0
  ) {
    return true;
  }

  // fe80::/10 (link-local)
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;

  // fc00::/7 (ULA)
  if ((b[0] & 0xfe) === 0xfc) return true;

  // ::ffff:0:0/96 (IPv4-mapped): extract embedded IPv4 and re-check
  const isIpv4Mapped =
    b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 0 &&
    b[4] === 0 && b[5] === 0 && b[6] === 0 && b[7] === 0 &&
    b[8] === 0 && b[9] === 0 && b[10] === 0xff && b[11] === 0xff;

  if (isIpv4Mapped) {
    const embedded = `${b[12]}.${b[13]}.${b[14]}.${b[15]}`;
    return isPrivateIpv4(embedded);
  }

  return false;
}

/**
 * Returns true if the given IP address (IPv4 or IPv6) is in any private,
 * reserved, or otherwise blocked range. Fails closed: returns true for
 * any address it cannot parse.
 */
export function isPrivateOrReservedIp(addr: string): boolean {
  const version = isIP(addr);
  if (version === 4) return isPrivateIpv4(addr);
  if (version === 6) return isPrivateIpv6(addr);
  return true; // unrecognized -> fail closed
}

// ---------- main fetch ----------

/**
 * Fetches a user-supplied URL with SSRF protection.
 *
 * Guards:
 *   - URL parse + http(s)-only scheme
 *   - DNS lookup; every resolved IP checked against private/reserved ranges
 *   - IPv4-mapped IPv6 (::ffff:a.b.c.d) re-checked against IPv4 ranges
 *   - Redirects disabled (TOCTOU defense)
 *   - Content-type allowlist (prefix + exact match)
 *   - Stream-based byte counter (Content-Length not trusted)
 *   - Connect timeout + total request timeout via AbortController
 *
 * Returns errors as values. Never throws across this boundary.
 */
export async function safeUserFetch(
  rawUrl: string,
  opts: SafeFetchOptions,
): Promise<SafeFetchResult> {
  // 1. Parse URL
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { success: false, message: "Malformed URL.", reason: "invalid_url" };
  }

  // 2. Scheme check
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      success: false,
      message: `Scheme "${parsed.protocol}" is not allowed. Use http or https.`,
      reason: "blocked_scheme",
    };
  }

  // 3. Empty hostname
  const host = parsed.hostname;
  if (!host || !host.trim()) {
    return { success: false, message: "Empty hostname.", reason: "blocked_host" };
  }

  // 4. DNS resolution / literal IP validation
  let addresses: { address: string; family: number }[];

  if (isIP(host) !== 0) {
    addresses = [{ address: host, family: isIP(host) }];
  } else {
    try {
      addresses = await dnsLookup(host, { all: true, verbatim: false });
    } catch (err) {
      return {
        success: false,
        message: `DNS lookup failed for "${host}": ${err instanceof Error ? err.message : "unknown error"}`,
        reason: "dns_failure",
      };
    }
    if (addresses.length === 0) {
      return {
        success: false,
        message: `DNS lookup returned no addresses for "${host}".`,
        reason: "dns_failure",
      };
    }
  }

  // 5. Check every resolved address against the blocklist
  for (const entry of addresses) {
    if (isPrivateOrReservedIp(entry.address)) {
      return {
        success: false,
        message: `Host "${host}" resolves to a blocked IP address.`,
        reason: "blocked_ip",
      };
    }
  }

  // 6. Abort controller + timeout timers
  const controller = new AbortController();
  let abortedByTimeout = false;
  let abortedBySize = false;

  const totalTimer = setTimeout(() => {
    abortedByTimeout = true;
    controller.abort();
  }, opts.totalTimeoutMs);

  const connectTimer = setTimeout(() => {
    abortedByTimeout = true;
    controller.abort();
  }, opts.connectTimeoutMs);

  try {
    // 7. Fetch with redirects disabled
    let response: Response;
    try {
      response = await fetch(rawUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "Sharetopus-MCP/1.0" },
      });
    } catch (err) {
      if (abortedByTimeout) {
        return { success: false, message: "Connection timed out.", reason: "timeout" };
      }
      return {
        success: false,
        message: `Fetch failed: ${err instanceof Error ? err.message : "unknown error"}`,
        reason: "fetch_failed",
      };
    } finally {
      clearTimeout(connectTimer);
    }

    // 8. Reject redirects (TOCTOU defense)
    if (response.status >= 300 && response.status < 400) {
      return {
        success: false,
        message: `Redirects are not allowed (HTTP ${response.status}).`,
        reason: "redirect_not_allowed",
      };
    }

    if (!response.ok) {
      return {
        success: false,
        message: `HTTP ${response.status} ${response.statusText}`,
        reason: "fetch_failed",
      };
    }

    // 9. Content-type validation
    const rawCt = response.headers.get("content-type") ?? "";
    const contentType = rawCt.split(";")[0].trim().toLowerCase();

    const prefixOk = opts.allowedContentTypePrefixes.some((p) =>
      contentType.startsWith(p),
    );
    if (!prefixOk) {
      return {
        success: false,
        message: `Content type "${contentType}" does not match any allowed prefix.`,
        reason: "content_type_not_allowed",
      };
    }

    const exactOk = opts.allowedContentTypes.some(
      (t) => t.toLowerCase() === contentType,
    );
    if (!exactOk) {
      return {
        success: false,
        message: `Content type "${contentType}" is not in the allowlist: ${opts.allowedContentTypes.join(", ")}.`,
        reason: "content_type_not_allowed",
      };
    }

    // 10. Stream body with byte counting
    if (!response.body) {
      return { success: false, message: "Response has no body.", reason: "fetch_failed" };
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let byteCount = 0;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        byteCount += value.byteLength;
        if (byteCount > opts.maxBytes) {
          abortedBySize = true;
          controller.abort();
          return {
            success: false,
            message: `Response body exceeds the ${Math.round(opts.maxBytes / 1024 / 1024)} MB limit.`,
            reason: "too_large",
          };
        }
        chunks.push(value);
      }
    } catch (err) {
      if (abortedBySize) {
        return {
          success: false,
          message: `Response body exceeds the ${Math.round(opts.maxBytes / 1024 / 1024)} MB limit.`,
          reason: "too_large",
        };
      }
      if (abortedByTimeout) {
        return { success: false, message: "Request timed out.", reason: "timeout" };
      }
      return {
        success: false,
        message: `Stream read failed: ${err instanceof Error ? err.message : "unknown error"}`,
        reason: "fetch_failed",
      };
    }

    return {
      success: true,
      bytes: Buffer.concat(chunks),
      contentType,
      finalUrl: rawUrl,
    };
  } finally {
    clearTimeout(totalTimer);
    clearTimeout(connectTimer);
  }
}
