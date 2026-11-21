import "server-only";

import { requestTokenRefresh, type TokenRefreshResult } from "@/lib/api/requestTokenRefresh";

const LINKEDIN_FALLBACK_EXPIRES_IN_SECONDS = 7200;

export default async function refreshLinkedInToken(
  refreshToken: string,
): Promise<TokenRefreshResult> {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("[refreshLinkedInToken] LinkedIn configuration missing.");
    return { kind: "failed", message: "LinkedIn configuration missing." };
  }

  return requestTokenRefresh({
    caller: "refreshLinkedInToken",
    url: "https://www.linkedin.com/oauth/v2/accessToken",
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    currentRefreshToken: refreshToken,
    fallbackExpiresInSeconds: LINKEDIN_FALLBACK_EXPIRES_IN_SECONDS,
  });
}
