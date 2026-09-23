import "server-only";

import { requestTokenRefresh, type TokenRefreshResult } from "@/lib/api/requestTokenRefresh";

/** 60 days in seconds, the documented long-lived token lifetime. */
const LONG_LIVED_FALLBACK_SECONDS = 60 * 24 * 60 * 60;

/**
 * Refreshes an Instagram LONG-LIVED access token before it expires.
 *
 * Instagram Login has no refresh_token: the long-lived ACCESS token itself
 * is exchanged for a fresh 60-day one, so the caller passes the current
 * access token (not social_accounts.refresh_token). Instagram requires the
 * token to be at least 24 hours old and still valid; an expired token is
 * refused and the user must reconnect. The URL carries the token, and
 * requestTokenRefresh never logs it.
 * sourceRef: https://developers.facebook.com/docs/instagram-platform/reference/refresh_access_token
 *
 * Called by: ensureValidToken (case "instagram")
 */
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
    fallbackExpiresInSeconds: LONG_LIVED_FALLBACK_SECONDS,
  });
}
