import "server-only";

import { fetch as undiciFetch, type Response as UndiciResponse } from "undici";

import {
  buildPinnedAgent,
  resolveHostToPublicAddresses,
} from "@/lib/net/pinnedFetch";

/**
 * HTTP for provider calls whose host comes from the USER, not from us.
 *
 * Instance-hosted providers (Mastodon, Lemmy, WordPress, a self-hosted
 * Bluesky PDS) take a server URL as a connect field. That URL is untrusted
 * input: without a guard, a user could point a "Mastodon instance" at
 * http://169.254.169.254 or an internal address and turn every scheduled
 * post into a request against our own infrastructure, with the response
 * body handed back in the error message.
 *
 * Same treatment the webhook sender gets: resolve DNS once, reject any
 * private or reserved address, pin the socket to the validated IP so
 * rebinding cannot swap it after the check, and refuse redirects.
 *
 * Providers on fixed first-party hosts (Discord, Telegram) do not need
 * this and call fetch directly.
 *
 * Called by: instance-hosted provider modules.
 * Tables touched: none.
 */

/** Cap on the response body we read from a user-supplied host. */
const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024;

export type ProviderFetchResult =
  | { ok: true; status: number; bodyText: string }
  | { ok: false; message: string };

export type ProviderFetchOptions = {
  method: "GET" | "POST" | "PUT";
  headers?: Record<string, string>;
  /** Pre-serialized request body. */
  body?: string | Uint8Array;
  timeoutMs: number;
};

/**
 * Performs one SSRF-guarded request against a user-supplied absolute URL.
 * Returns the raw body text; callers parse it. Errors as values.
 */
export async function providerFetch(
  rawUrl: string,
  options: ProviderFetchOptions,
): Promise<ProviderFetchResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return { ok: false, message: "Provider URL is not a valid absolute URL." };
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return {
      ok: false,
      message: `Provider URL scheme "${parsedUrl.protocol}" is not allowed.`,
    };
  }

  const resolution = await resolveHostToPublicAddresses(parsedUrl.hostname);
  if (!resolution.ok) {
    return {
      ok: false,
      message: `Provider host is not reachable or not permitted (${resolution.reason}).`,
    };
  }

  const dispatcher = buildPinnedAgent(resolution.addresses);
  try {
    const response = await undiciFetch(rawUrl, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs),
      dispatcher,
    });

    if (response.status >= 300 && response.status < 400) {
      return {
        ok: false,
        message: `Provider redirected (HTTP ${response.status}); redirects are not followed.`,
      };
    }

    const bodyText = await readCappedBody(response);
    return { ok: true, status: response.status, bodyText };
  } catch (requestError) {
    return {
      ok: false,
      message:
        requestError instanceof Error
          ? requestError.message
          : "Unknown network error calling the provider.",
    };
  } finally {
    dispatcher.close().catch(() => {});
  }
}

/**
 * Reads at most MAX_PROVIDER_RESPONSE_BYTES and stops pulling. A hostile
 * or broken instance must not be able to stream unbounded bytes into the
 * function's memory.
 */
async function readCappedBody(response: UndiciResponse): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteCount = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) continue;
      chunks.push(value);
      byteCount += value.byteLength;
      if (byteCount >= MAX_PROVIDER_RESPONSE_BYTES) break;
    }
  } catch {
    // A short read still leaves whatever arrived usable for diagnostics.
  } finally {
    reader.cancel().catch(() => {});
  }

  if (chunks.length === 0) return "";
  return Buffer.concat(chunks)
    .subarray(0, MAX_PROVIDER_RESPONSE_BYTES)
    .toString("utf-8");
}

/**
 * Parses a JSON body without throwing. Providers return varied shapes, so
 * callers narrow the unknown themselves.
 */
export function parseJsonBody(bodyText: string): unknown {
  try {
    return JSON.parse(bodyText);
  } catch {
    return null;
  }
}

/** Reads a string field from an unknown JSON object, or null. */
export function readStringField(
  source: unknown,
  fieldName: string,
): string | null {
  if (!source || typeof source !== "object") return null;
  const value = (source as Record<string, unknown>)[fieldName];
  return typeof value === "string" ? value : null;
}
