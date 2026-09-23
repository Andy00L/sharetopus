import "server-only";

import { requestTokenRefresh, type TokenRefreshResult } from "@/lib/api/requestTokenRefresh";

/**
 * Refreshes a TikTok access token with the stored refresh token. TikTok
 * takes the app credentials as client_key and client_secret in the form
 * body, like the code exchange (exchangeTikTokCode), and development
 * builds use the sandbox app.
 *
 * Called by: ensureValidToken (case "tiktok")
 */
export default async function refreshTikTokToken(
  refreshToken: string,
): Promise<TokenRefreshResult> {
  const isDevelopment = process.env.NODE_ENV === "development";
  const clientKey = isDevelopment
    ? process.env.TIKTOK_CLIENT_KEY_DEV
    : process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = isDevelopment
    ? process.env.TIKTOK_CLIENT_SECRET_DEV
    : process.env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || !clientSecret) {
    console.error("[refreshTikTokToken] TikTok configuration missing.");
    return { kind: "failed", message: "TikTok configuration missing." };
  }

  return requestTokenRefresh({
    caller: "refreshTikTokToken",
    url: "https://open.tiktokapis.com/v2/oauth/token/",
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    currentRefreshToken: refreshToken,
  });
}
