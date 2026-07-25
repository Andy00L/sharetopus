import "server-only";

import { fetch as undiciFetch, type Response as UndiciResponse } from "undici";

import {
  buildPinnedAgent,
  resolveHostToPublicAddresses,
} from "@/lib/net/pinnedFetch";

/**
 * Delivers one signed webhook POST with SSRF protection at the moment of
 * delivery (not just at subscription-create time). The subscriber host is
 * resolved once, every resolved IP is rejected if private/reserved, and the
 * connection is PINNED to the validated IP so DNS rebinding cannot redirect
 * the request to an internal target between check and connect. Redirects are
 * disabled for the same reason.
 *
 * Errors are values: a blocked host, DNS failure, non-HTTPS URL, timeout, or
 * transport error all come back as { statusCode: null, errorMessage }.
 */
export type WebhookDeliveryOutcome = {
  statusCode: number | null;
  responseBody: string | null;
  errorMessage: string | null;
};

const MAX_RESPONSE_BODY_CHARS = 4096;

/**
 * Hard cap on bytes read from a subscriber's response. The stored excerpt is
 * MAX_RESPONSE_BODY_CHARS, so 64 KB is far more than needed while bounding
 * what a hostile or broken subscriber can push into function memory. The
 * previous `(await response.text()).slice(...)` buffered the ENTIRE body
 * before truncating, so a subscriber replying with a multi-gigabyte stream
 * could exhaust the delivery function's memory. Subscriber URLs are chosen
 * by API consumers, so that body is untrusted input.
 */
const MAX_RESPONSE_BODY_BYTES = 64 * 1024;

/**
 * Reads at most MAX_RESPONSE_BODY_BYTES from a response stream and decodes
 * the result as UTF-8. Stops pulling as soon as the cap is reached, so the
 * rest of a hostile body is never buffered. Returns null when the response
 * has no body or the stream fails; the delivery outcome does not depend on
 * the excerpt, which is stored for operator debugging only.
 */
async function readCappedResponseBody(
  response: UndiciResponse,
): Promise<string | null> {
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteCount = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // undici types its body as an unparameterized ReadableStream; the
      // runtime always yields Uint8Array chunks. Guarding instead of
      // casting means a future undici change degrades to a short excerpt
      // rather than throwing mid-delivery.
      if (!(value instanceof Uint8Array)) continue;
      chunks.push(value);
      byteCount += value.byteLength;
      if (byteCount >= MAX_RESPONSE_BODY_BYTES) break;
    }
  } catch {
    // A truncated or failed read still leaves whatever arrived usable.
  } finally {
    reader.cancel().catch(() => {});
  }

  if (chunks.length === 0) return "";
  return Buffer.concat(chunks)
    .subarray(0, MAX_RESPONSE_BODY_BYTES)
    .toString("utf-8");
}

export async function deliverSignedWebhook(
  url: string,
  opts: {
    headers: Record<string, string>;
    body: string;
    timeoutMs: number;
  },
): Promise<WebhookDeliveryOutcome> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { statusCode: null, responseBody: null, errorMessage: "invalid webhook url" };
  }

  // Webhooks are HTTPS-only (also enforced at subscription create/update).
  if (parsed.protocol !== "https:") {
    return {
      statusCode: null,
      responseBody: null,
      errorMessage: "webhook url must use https",
    };
  }

  const resolution = await resolveHostToPublicAddresses(parsed.hostname);
  if (!resolution.ok) {
    return {
      statusCode: null,
      responseBody: null,
      errorMessage: `webhook host blocked (${resolution.reason})`,
    };
  }

  const dispatcher = buildPinnedAgent(resolution.addresses);
  try {
    const response = await undiciFetch(url, {
      method: "POST",
      headers: opts.headers,
      body: opts.body,
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs),
      dispatcher,
    });
    const cappedBody = await readCappedResponseBody(response);
    const responseBody =
      cappedBody === null ? null : cappedBody.slice(0, MAX_RESPONSE_BODY_CHARS);
    return { statusCode: response.status, responseBody, errorMessage: null };
  } catch (deliveryError) {
    return {
      statusCode: null,
      responseBody: null,
      errorMessage:
        deliveryError instanceof Error
          ? deliveryError.message
          : "unknown network error",
    };
  } finally {
    dispatcher.close().catch(() => {});
  }
}
