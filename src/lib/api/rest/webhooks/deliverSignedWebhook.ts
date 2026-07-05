import "server-only";

import { fetch as undiciFetch } from "undici";

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
    const responseBody = (await response.text()).slice(0, MAX_RESPONSE_BODY_CHARS);
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
