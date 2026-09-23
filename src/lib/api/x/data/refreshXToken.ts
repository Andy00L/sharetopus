import "server-only";

import { requestTokenRefresh, type TokenRefreshResult } from "@/lib/api/requestTokenRefresh";
import { buildBasicAuthHeader } from "./exchangeXCode";

/**
 * Refreshes an expired X access token. Requires the offline.access scope on
 * the original grant. X rotates the refresh token: every refresh returns a
 * new one and the old one stops working, so the caller must store the
 * returned value. The old one is kept only if the answer omits it.
 * sourceRef: https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token
 *
 * Called by: ensureValidToken (case "x")
 */
export default async function refreshXToken(
  refreshToken: string,
): Promise<TokenRefreshResult> {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("[refreshXToken] X configuration missing.");
    return { kind: "failed", message: "X configuration missing." };
  }

  return requestTokenRefresh({
    caller: "refreshXToken",
    url: "https://api.x.com/2/oauth2/token",
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: buildBasicAuthHeader(clientId, clientSecret),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }),
    currentRefreshToken: refreshToken,
  });
}
