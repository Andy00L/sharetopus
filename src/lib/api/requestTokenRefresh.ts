import "server-only";

import { z } from "zod";

import {
  ERROR_BODY_LOG_LIMIT_CHARS,
  parseJsonBody,
  readOAuthError,
} from "@/lib/api/oauth/readOAuthAnswer";
import type { TokenExchangeResponse } from "@/lib/types/dbTypes";

const REFRESH_TIMEOUT_MS = 15_000;

export type TokenRefreshResult =
  | { kind: "refreshed"; tokens: TokenExchangeResponse }
  | { kind: "rejected"; message: string }
  | { kind: "failed"; message: string };

// invalid_client and unauthorized_client blame the app's own client credentials,
// not the user's token: https://www.rfc-editor.org/rfc/rfc6749#section-5.2
const CLIENT_CREDENTIAL_ERRORS = new Set(["invalid_client", "unauthorized_client"]);

const RefreshResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
  refresh_token: z.string().min(1).optional(),
});

export async function requestTokenRefresh(request: {
  caller: string;
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: URLSearchParams;
  currentRefreshToken: string | null;
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
      `[${request.caller}] Refresh refused (${status}): ${responseText.slice(0, ERROR_BODY_LOG_LIMIT_CHARS)}`,
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

function classifyRefusal(status: number, oauthError: string | null): "rejected" | "failed" {
  if (oauthError !== null && CLIENT_CREDENTIAL_ERRORS.has(oauthError)) return "failed";
  if (oauthError === "invalid_grant") return "rejected";
  return status === 400 || status === 401 ? "rejected" : "failed";
}
