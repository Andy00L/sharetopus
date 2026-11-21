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

export type ProviderFetchFailure =
  | { ok: false; kind: "not_sent"; reason: "invalid_input" | "transient"; message: string }
  | { ok: false; kind: "no_answer"; message: string }
  | { ok: false; kind: "redirected"; status: number; message: string }
  | { ok: false; kind: "unreadable_body"; status: number; message: string };

export type ProviderFetchResult =
  | {
      ok: true;
      status: number;
      bodyText: string;
      headers: Readonly<Record<string, string>>;
    }
  | ProviderFetchFailure;

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
    return {
      ok: false,
      kind: "not_sent",
      reason: "invalid_input",
      message: "Provider URL is not a valid absolute URL.",
    };
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return {
      ok: false,
      kind: "not_sent",
      reason: "invalid_input",
      message: `Provider URL scheme "${parsedUrl.protocol}" is not allowed.`,
    };
  }

  const resolution = await resolveHostToPublicAddresses(parsedUrl.hostname);
  if (!resolution.ok) {
    return {
      ok: false,
      kind: "not_sent",
      reason: resolution.reason === "dns_failure" ? "transient" : "invalid_input",
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
        kind: "redirected",
        status: response.status,
        message: `Provider redirected (HTTP ${response.status}); redirects are not followed.`,
      };
    }

    const bodyRead = await readCappedBody(response);
    if (!bodyRead.ok) {
      return {
        ok: false,
        kind: "unreadable_body",
        status: response.status,
        message: `Provider answered HTTP ${response.status} but ${bodyRead.problem}.`,
      };
    }
    return {
      ok: true,
      status: response.status,
      bodyText: bodyRead.bodyText,
      headers: Object.fromEntries(response.headers),
    };
  } catch (requestError) {
    return { ok: false, kind: "no_answer", message: describeNetworkError(requestError) };
  }
}

type CappedBodyRead =
  | { ok: true; bodyText: string }
  | { ok: false; problem: string };

async function readCappedBody(response: UndiciResponse): Promise<CappedBodyRead> {
  if (!response.body) return { ok: true, bodyText: "" };

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
      if (byteCount > MAX_PROVIDER_RESPONSE_BYTES) {
        return {
          ok: false,
          problem: `its body is over the ${MAX_PROVIDER_RESPONSE_BYTES / 1024}KB read limit`,
        };
      }
    }
  } catch (readError) {
    return {
      ok: false,
      problem: `its body could not be read: ${describeNetworkError(readError)}`,
    };
  } finally {
    reader.cancel().catch(() => {});
  }

  return { ok: true, bodyText: Buffer.concat(chunks).toString("utf-8") };
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
