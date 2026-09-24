import "server-only";

import { z } from "zod";

import { parseJsonBody, readOAuthError } from "@/lib/api/oauth/readOAuthAnswer";
import type { TokenExchangeResponse } from "@/lib/types/dbTypes";

/** Outbound token refresh calls are bounded to 15s. */
const REFRESH_TIMEOUT_MS = 15_000;

/** Characters of an error body kept in logs. Error bodies never hold tokens. */
const ERROR_BODY_LOG_LIMIT = 300;

/**
 * Outcome of refreshing a platform token.
 * - refreshed: new tokens to store.
 * - rejected: the platform refused the stored credential (revoked, expired,
 *   or already rotated). Only a reconnect helps, so the caller flags the
 *   account as needing re-authentication.
 * - failed: anything a later attempt may get past (missing config, network
 *   error, timeout, 429, 5xx, an unreadable answer). The account is left
 *   as it is.
 */
export type TokenRefreshResult =
  | { kind: "refreshed"; tokens: TokenExchangeResponse }
  | { kind: "rejected"; message: string }
  | { kind: "failed"; message: string };

/**
 * OAuth error codes that blame the app's own client credentials, not the
 * user's token (RFC 6749 section 5.2). A misconfigured client secret must
 * not flag every account as needing a reconnect.
 */
const CLIENT_CREDENTIAL_ERRORS = new Set(["invalid_client", "unauthorized_client"]);

const RefreshResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
  refresh_token: z.string().min(1).optional(),
});

/**
 * Sends one token refresh request and classifies the answer. Each platform
 * refresh function supplies its endpoint, credentials and body; this owns
 * the timeout, the parsing and the rejected-versus-failed decision, and it
 * never logs an answer that could hold tokens.
 *
 * Called by: the refresh*Token functions under src/lib/api/<platform>/data
 */
export async function requestTokenRefresh(request: {
  /** Name of the calling function, used as the log prefix. */
  caller: string;
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: URLSearchParams;
  /** Kept when the platform does not return a new refresh token. */
  currentRefreshToken: string | null;
  /** Lifetime assumed when the answer omits expires_in, in seconds. */
  fallbackExpiresInSeconds?: number;
}): Promise<TokenRefreshResult> {
  let status: number;
  let isOk: boolean;
  let responseText: string;
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body?.toString(),
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
    status = response.status;
    isOk = response.ok;
    responseText = await response.text();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${request.caller}] Refresh request failed: ${message}`);
    return { kind: "failed", message };
  }

  const responseBody = parseJsonBody(responseText);
  const oauthError = readOAuthError(responseBody);

  if (!isOk || oauthError !== null) {
    console.error(
      `[${request.caller}] Refresh refused (${status}): ${responseText.slice(0, ERROR_BODY_LOG_LIMIT)}`,
    );
    const message = `Refresh refused (${status}${oauthError ? `, ${oauthError}` : ""}).`;
    return { kind: classifyRefusal(status, oauthError), message };
  }

  const parsed = RefreshResponseSchema.safeParse(responseBody);
  if (!parsed.success) {
    console.error(`[${request.caller}] Refresh answer failed validation.`);
    return { kind: "failed", message: "Refresh answer failed validation." };
  }

  const expiresIn = parsed.data.expires_in ?? request.fallbackExpiresInSeconds;
  if (expiresIn === undefined) {
    console.error(`[${request.caller}] Refresh answer has no expires_in.`);
    return { kind: "failed", message: "Refresh answer has no expires_in." };
  }

  return {
    kind: "refreshed",
    tokens: {
      access_token: parsed.data.access_token,
      refresh_token: parsed.data.refresh_token ?? request.currentRefreshToken ?? undefined,
      expires_in: expiresIn,
    },
  };
}

/**
 * invalid_grant and HTTP 400/401 mean the stored credential is dead, except
 * when the error blames the app's own credentials. Everything else (429,
 * 5xx, an error code on a 200) may pass on a later attempt.
 */
function classifyRefusal(status: number, oauthError: string | null): "rejected" | "failed" {
  if (oauthError !== null && CLIENT_CREDENTIAL_ERRORS.has(oauthError)) return "failed";
  if (oauthError === "invalid_grant") return "rejected";
  return status === 400 || status === 401 ? "rejected" : "failed";
}
