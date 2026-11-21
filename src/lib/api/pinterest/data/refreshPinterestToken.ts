import "server-only";

import { buildBasicAuthHeader } from "@/lib/api/oauth/buildBasicAuthHeader";
import { requestTokenRefresh, type TokenRefreshResult } from "@/lib/api/requestTokenRefresh";

export default async function refreshPinterestToken(
  refreshToken: string,
): Promise<TokenRefreshResult> {
  const clientId = process.env.PINTEREST_CLIENT_ID;
  const clientSecret = process.env.PINTEREST_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("[refreshPinterestToken] Pinterest configuration missing.");
    return { kind: "failed", message: "Pinterest configuration missing." };
  }

  return requestTokenRefresh({
    caller: "refreshPinterestToken",
    url: "https://api.pinterest.com/v5/oauth/token",
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: buildBasicAuthHeader(clientId, clientSecret),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    currentRefreshToken: refreshToken,
  });
}
