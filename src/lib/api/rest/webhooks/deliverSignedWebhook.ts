import "server-only";

import { fetch as undiciFetch, type Response as UndiciResponse } from "undici";

import { describeNetworkError } from "@/lib/net/describeNetworkError";
import {
  acquirePinnedDispatcher,
  resolveHostToPublicAddresses,
} from "@/lib/net/pinnedFetch";

export type WebhookDeliveryOutcome = {
  statusCode: number | null;
  responseBody: string | null;
  errorMessage: string | null;
};

const MAX_RESPONSE_BODY_CHARS = 4096;

const MAX_RESPONSE_BODY_BYTES = 64 * 1024;

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
      // undici/types/fetch.d.ts types Response.body as an unparameterized
      // ReadableStream, so each chunk is narrowed here.
      if (!(value instanceof Uint8Array)) continue;
      chunks.push(value);
      byteCount += value.byteLength;
      if (byteCount >= MAX_RESPONSE_BODY_BYTES) break;
    }
  } catch (readError) {
    console.warn(
      "[readCappedResponseBody] Subscriber body read stopped early:",
      describeNetworkError(readError),
    );
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

  try {
    const response = await undiciFetch(url, {
      method: "POST",
      headers: opts.headers,
      body: opts.body,
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs),
      dispatcher: acquirePinnedDispatcher(resolution.addresses),
    });
    const cappedBody = await readCappedResponseBody(response);
    const responseBody =
      cappedBody === null ? null : cappedBody.slice(0, MAX_RESPONSE_BODY_CHARS);
    return { statusCode: response.status, responseBody, errorMessage: null };
  } catch (deliveryError) {
    return {
      statusCode: null,
      responseBody: null,
      errorMessage: describeNetworkError(deliveryError),
    };
  }
}
