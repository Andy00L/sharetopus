import "server-only";

import type { z } from "zod";

import { parseJsonBody, readOAuthError } from "./readOAuthAnswer";

/** Outbound OAuth code exchanges are bounded to 15s. */
const EXCHANGE_TIMEOUT_MS = 15_000;

/** Characters of an error body kept in logs, as in requestTokenRefresh. */
const ERROR_BODY_LOG_LIMIT = 300;

/**
 * Sends one OAuth token request (an authorization-code exchange, or the
 * long-lived token swap that follows it on Instagram and Facebook) and
 * validates the answer against `schema`.
 *
 * Owns the timeout and the logging rule: an error body is logged, a
 * successful body never is (it holds the user's tokens), and neither is the
 * URL, which carries the client secret on GET exchanges.
 *
 * Called by: the exchange*Code functions under src/lib/api/<platform>/data
 */
export async function requestCodeExchange<Answer>(request: {
  /** Name of the calling function, used as the log prefix. */
  caller: string;
  /** Platform name for user-facing messages, e.g. "LinkedIn". */
  platformLabel: string;
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: URLSearchParams;
  schema: z.ZodType<Answer>;
}): Promise<{ ok: true; answer: Answer } | { ok: false; message: string }> {
  let responseText: string;
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.body
        ? { "Content-Type": "application/x-www-form-urlencoded", ...request.headers }
        : request.headers,
      body: request.body?.toString(),
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });
    responseText = await response.text();
    if (!response.ok) {
      console.error(
        `[${request.caller}] HTTP ${response.status}: ${responseText.slice(0, ERROR_BODY_LOG_LIMIT)}`,
      );
      return {
        ok: false,
        message: `${request.platformLabel} token exchange failed (${response.status}).`,
      };
    }
  } catch (error) {
    console.error(
      `[${request.caller}] Token request failed:`,
      error instanceof Error ? error.message : error,
    );
    return {
      ok: false,
      message: `${request.platformLabel} token exchange request failed.`,
    };
  }

  const answerBody = parseJsonBody(responseText);
  const parsed = request.schema.safeParse(answerBody);
  if (!parsed.success) {
    // A 2xx answer can still carry an OAuth error body. Only its error code
    // is logged: the body failed validation, so it may also be a token
    // answer of a new shape.
    const oauthError = readOAuthError(answerBody);
    console.error(
      `[${request.caller}] Token answer failed validation${oauthError ? ` (error: ${oauthError})` : ""}.`,
    );
    return {
      ok: false,
      message: `${request.platformLabel} token answer had an unexpected shape.`,
    };
  }
  return { ok: true, answer: parsed.data };
}
