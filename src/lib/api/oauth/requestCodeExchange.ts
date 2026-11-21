import "server-only";

import type { z } from "zod";

import { ERROR_BODY_LOG_LIMIT_CHARS, parseJsonBody, readOAuthError } from "./readOAuthAnswer";

const EXCHANGE_TIMEOUT_MS = 15_000;

export async function requestCodeExchange<Answer>(request: {
  caller: string;
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
        `[${request.caller}] HTTP ${response.status}: ${responseText.slice(0, ERROR_BODY_LOG_LIMIT_CHARS)}`,
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
