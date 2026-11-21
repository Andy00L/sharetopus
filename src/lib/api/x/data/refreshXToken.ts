import "server-only";

import { buildBasicAuthHeader } from "@/lib/api/oauth/buildBasicAuthHeader";
import { requestTokenRefresh, type TokenRefreshResult } from "@/lib/api/requestTokenRefresh";

// X issues a refresh token only when the grant asked for offline.access, and it
// rotates the refresh token: every refresh returns a new one and the old one
// stops working: https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token
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
