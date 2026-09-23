import "server-only";

import { requestTokenRefresh, type TokenRefreshResult } from "@/lib/api/requestTokenRefresh";

/**
 * Lifetime assumed when LinkedIn's answer omits expires_in, in seconds
 * (2 hours, the value this function has always used as its fallback).
 */
const LINKEDIN_FALLBACK_EXPIRES_IN_SECONDS = 7200;

/**
 * Refreshes a LinkedIn access token with the stored refresh token. The app
 * credentials go in the form body, like the code exchange
 * (exchangeLinkedInCode).
 *
 * Called by: ensureValidToken (case "linkedin")
 */
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
