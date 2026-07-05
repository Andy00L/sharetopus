import "server-only";

import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";

import {
  buildPinnedAgent,
  resolveHostToPublicAddresses,
} from "@/lib/net/pinnedFetch";

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

// ---------- main fetch ----------

/**
 * Fetches a user-supplied URL with SSRF protection.
 *
 * Guards:
 *   - URL parse + http(s)-only scheme
 *   - DNS resolved ONCE; every resolved IP checked against private/reserved
 *     ranges (IPv4-mapped IPv6 re-checked against IPv4 ranges)
 *   - The connection is PINNED to the validated IP via a per-request undici
 *     dispatcher, closing the DNS-rebinding TOCTOU (the socket cannot
 *     re-resolve to an internal address after the check)
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

  // 3. Resolve DNS once and validate every address against the blocklist.
  const resolution = await resolveHostToPublicAddresses(parsed.hostname);
  if (!resolution.ok) {
    if (resolution.reason === "blocked_host") {
      return { success: false, message: "Empty hostname.", reason: "blocked_host" };
    }
    if (resolution.reason === "dns_failure") {
      return {
        success: false,
        message: `DNS lookup failed for "${parsed.hostname}".`,
        reason: "dns_failure",
      };
    }
    return {
      success: false,
      message: `Host "${parsed.hostname}" resolves to a blocked IP address.`,
      reason: "blocked_ip",
    };
  }

  // 4. Pin the connection to the validated IP (rebinding defense) and set
  // up the abort/timeout timers.
  const dispatcher: Agent = buildPinnedAgent(resolution.addresses);
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
    // 5. Fetch with redirects disabled, pinned to the validated IP.
    let response: UndiciResponse;
    try {
      response = await undiciFetch(rawUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "Sharetopus-MCP/1.0" },
        dispatcher,
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

    // 6. Reject redirects (TOCTOU defense)
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

    // 7. Content-type validation
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

    // 8. Stream body with byte counting
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
    dispatcher.close().catch(() => {});
  }
}
