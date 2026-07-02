import "server-only";

import { z } from "zod";

import type {
  TokenExchangeResponse,
  TokenExchangeResult,
} from "@/lib/types/dbTypes";

/** Outbound X OAuth calls are bounded to 15s. */
const EXCHANGE_TIMEOUT_MS = 15_000;

/**
 * Token endpoint response for grant_type=authorization_code.
 * sourceRef: https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token
 */
const XTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

/**
 * Exchange an X OAuth 2.0 authorization code for tokens (web connect flow).
 *
 * X requires PKCE on every authorization-code exchange, so the caller must
 * supply the code_verifier that produced the code_challenge in the
 * authorize URL. Confidential clients (this server) authenticate with HTTP
 * Basic auth on the token endpoint.
 *
 * Called by: /api/social/x/connect
 */
export async function exchangeXCode(
  code: string,
  codeVerifier: string,
): Promise<TokenExchangeResult> {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  const redirectUri = process.env.X_REDIRECT_URL;

  if (!clientId || !clientSecret || !redirectUri) {
    console.error("[exchangeXCode] X configuration missing.");
    return {
      success: false,
      message: "X configuration missing. Check environment variables.",
    };
  }

  if (!codeVerifier) {
    console.error("[exchangeXCode] Missing PKCE code_verifier.");
    return {
      success: false,
      message: "Missing PKCE verifier for the X token exchange.",
    };
  }

  const params = new URLSearchParams();
  params.append("grant_type", "authorization_code");
  params.append("code", code);
  params.append("redirect_uri", redirectUri);
  params.append("code_verifier", codeVerifier);
  params.append("client_id", clientId);

  try {
    // sourceRef: https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token
    const response = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: buildBasicAuthHeader(clientId, clientSecret),
      },
      body: params.toString(),
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(
        `[exchangeXCode] HTTP ${response.status}: ${responseText}`,
      );
      return {
        success: false,
        message: `X code exchange failed (${response.status}).`,
      };
    }

    const parsed = XTokenSchema.safeParse(JSON.parse(responseText));
    if (!parsed.success) {
      console.error(
        "[exchangeXCode] Token response failed validation (missing access_token or expires_in).",
      );
      return {
        success: false,
        message: "X token response had an unexpected shape.",
      };
    }

    const tokenResponse: TokenExchangeResponse = {
      access_token: parsed.data.access_token,
      refresh_token: parsed.data.refresh_token,
      expires_in: parsed.data.expires_in,
      scope: parsed.data.scope,
      token_type: parsed.data.token_type,
    };

    return { success: true, data: tokenResponse };
  } catch (error) {
    console.error(
      "[exchangeXCode] Token exchange error:",
      error instanceof Error ? error.message : error,
    );
    return { success: false, message: "X token exchange request failed." };
  }
}

/** HTTP Basic header for X confidential-client token calls. */
export function buildBasicAuthHeader(
  clientId: string,
  clientSecret: string,
): string {
  const encodedCredentials = Buffer.from(
    `${clientId}:${clientSecret}`,
  ).toString("base64");
  return `Basic ${encodedCredentials}`;
}
