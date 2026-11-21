import "server-only";

import { INSTAGRAM_LONG_LIVED_FALLBACK_SECONDS } from "@/lib/api/instagram/data/exchangeInstagramCode";
import { requestTokenRefresh, type TokenRefreshResult } from "@/lib/api/requestTokenRefresh";

// Instagram Login issues no refresh token: the long-lived access token itself is
// exchanged for a new one: https://developers.facebook.com/docs/instagram-platform/reference/refresh_access_token
export default async function refreshInstagramToken(
  longLivedAccessToken: string,
): Promise<TokenRefreshResult> {
  if (!longLivedAccessToken) {
    console.error("[refreshInstagramToken] Missing access token.");
    return { kind: "rejected", message: "No access token stored." };
  }

  return requestTokenRefresh({
    caller: "refreshInstagramToken",
    url:
      "https://graph.instagram.com/refresh_access_token" +
      "?grant_type=ig_refresh_token" +
      `&access_token=${encodeURIComponent(longLivedAccessToken)}`,
    method: "GET",
    currentRefreshToken: null,
    fallbackExpiresInSeconds: INSTAGRAM_LONG_LIVED_FALLBACK_SECONDS,
  });
}
