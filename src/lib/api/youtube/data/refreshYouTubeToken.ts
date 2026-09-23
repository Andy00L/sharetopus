import "server-only";

import { requestTokenRefresh, type TokenRefreshResult } from "@/lib/api/requestTokenRefresh";

/**
 * Refreshes an expired YouTube (Google) access token. Google does not
 * rotate the refresh token and omits it from the answer, so the stored one
 * is kept.
 * sourceRef: https://developers.google.com/identity/protocols/oauth2/web-server#offline
 *
 * Called by: ensureValidToken (case "youtube")
 */
export default async function refreshYouTubeToken(
  refreshToken: string,
): Promise<TokenRefreshResult> {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("[refreshYouTubeToken] YouTube configuration missing.");
    return { kind: "failed", message: "YouTube configuration missing." };
  }

  return requestTokenRefresh({
    caller: "refreshYouTubeToken",
    url: "https://oauth2.googleapis.com/token",
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    currentRefreshToken: refreshToken,
  });
}
