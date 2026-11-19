import "server-only";

import type { Blob } from "node:buffer";

import {
  fetch as undiciFetch,
  type FormData,
  type Response as UndiciResponse,
} from "undici";

import { describeNetworkError } from "@/lib/net/describeNetworkError";
import {
  acquirePinnedDispatcher,
  resolveHostToPublicAddresses,
} from "@/lib/net/pinnedFetch";
import { toJsonObject, type JsonObject } from "@/lib/utils/jsonObject";

const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024;

export type ProviderFetchResult =
  | { ok: true; status: number; bodyText: string }
  | { ok: false; message: string };

export type ProviderFetchOptions = {
  method: "GET" | "POST" | "PUT";
  headers?: Record<string, string>;
  /** FormData must be undici's class: undici's fetch serializes no other. */
  body?: string | Uint8Array | Blob | FormData;
  timeoutMs: number;
};

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

  try {
    const response = await undiciFetch(rawUrl, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs),
      dispatcher: acquirePinnedDispatcher(resolution.addresses),
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
    return { ok: false, message: describeNetworkError(requestError) };
  }
}

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
  } finally {
    reader.cancel().catch(() => {});
  }

  if (chunks.length === 0) return "";
  return Buffer.concat(chunks)
    .subarray(0, MAX_PROVIDER_RESPONSE_BYTES)
    .toString("utf-8");
}

export function parseJsonBody(bodyText: string): unknown {
  try {
    return JSON.parse(bodyText);
  } catch {
    return null;
  }
}

export function parseJsonObject(bodyText: string): JsonObject | null {
  return toJsonObject(parseJsonBody(bodyText));
}

export function readStringField(
  source: unknown,
  fieldName: string,
): string | null {
  const value = toJsonObject(source)?.[fieldName];
  return typeof value === "string" ? value : null;
}
