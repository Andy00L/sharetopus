import "server-only";

import { z } from "zod";

import { buildBasicAuthHeader } from "@/lib/api/oauth/buildBasicAuthHeader";
import { requestCodeExchange } from "@/lib/api/oauth/requestCodeExchange";
import type { TokenExchangeResult } from "@/lib/types/dbTypes";

/**
 * Token endpoint answer for grant_type=authorization_code.
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
 * Exchanges an X OAuth 2.0 authorization code for tokens.
 *
 * X requires PKCE on every authorization-code exchange, so the caller must
 * supply the code_verifier that produced the code_challenge in the
 * authorize URL. Confidential clients (this server) authenticate with HTTP
 * Basic auth on the token endpoint. `redirectUri` must be the exact URI the
 * authorize URL carried.
 *
 * Called by: connectPlatformAccounts
 */
export async function exchangeXCode(
  code: string,
  redirectUri: string,
  codeVerifier: string | null,
): Promise<TokenExchangeResult> {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("[exchangeXCode] X configuration missing.");
    return { success: false, message: "X configuration missing." };
  }
  if (!codeVerifier) {
    console.error("[exchangeXCode] Missing PKCE code_verifier.");
    return {
      success: false,
      message: "Missing PKCE verifier for the X token exchange.",
    };
  }

  const exchanged = await requestCodeExchange({
    caller: "exchangeXCode",
    platformLabel: "X",
    url: "https://api.x.com/2/oauth2/token",
    method: "POST",
    headers: { Authorization: buildBasicAuthHeader(clientId, clientSecret) },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      client_id: clientId,
    }),
    schema: XTokenSchema,
  });
  if (!exchanged.ok) return { success: false, message: exchanged.message };
  return { success: true, data: exchanged.answer };
}
