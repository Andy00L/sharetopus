import "server-only";

import { requestTokenRefresh, type TokenRefreshResult } from "@/lib/api/requestTokenRefresh";
import { readTikTokClientCredentials } from "@/lib/api/tiktok/data/readTikTokClientCredentials";

export default async function refreshTikTokToken(
  refreshToken: string,
): Promise<TokenRefreshResult> {
  const credentials = readTikTokClientCredentials();
  if (!credentials) {
    console.error("[refreshTikTokToken] TikTok configuration missing.");
    return { kind: "failed", message: "TikTok configuration missing." };
  }

  return requestTokenRefresh({
    caller: "refreshTikTokToken",
    url: "https://open.tiktokapis.com/v2/oauth/token/",
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: credentials.clientKey,
      client_secret: credentials.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    currentRefreshToken: refreshToken,
  });
}
