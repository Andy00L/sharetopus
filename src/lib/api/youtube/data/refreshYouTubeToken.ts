import "server-only";

import { z } from "zod";

import type { TokenExchangeResponse } from "@/lib/types/dbTypes";

/** Outbound Google OAuth calls are bounded to 15s. */
const REFRESH_TIMEOUT_MS = 15_000;

/**
 * Google token endpoint response for grant_type=refresh_token. Google does
 * not rotate the refresh token on refresh, so the response omits it.
 * sourceRef: https://developers.google.com/identity/protocols/oauth2/web-server#offline
 */
const GoogleRefreshSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number(),
});

/**
 * Refresh an expired YouTube (Google) access token.
 *
 * Returns null on any failure so ensureValidToken can surface its generic
 * "please reconnect" message; the caller keeps the original refresh token
 * because Google reuses it.
 *
 * Called by: ensureValidToken (case "youtube")
 */
export default async function refreshYouTubeToken(
  refreshToken: string,
): Promise<TokenExchangeResponse | null> {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("[refreshYouTubeToken] YouTube configuration missing.");
    return null;
  }

  const params = new URLSearchParams();
  params.append("grant_type", "refresh_token");
  params.append("refresh_token", refreshToken);
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(
        `[refreshYouTubeToken] Refresh failed (${response.status}): ${responseText}`,
      );
      return null;
    }

    const parsed = GoogleRefreshSchema.safeParse(JSON.parse(responseText));
    if (!parsed.success) {
      console.error(
        "[refreshYouTubeToken] Refresh response failed validation.",
      );
      return null;
    }

    return {
      access_token: parsed.data.access_token,
      // Google keeps the same refresh token; return it so the DB update
      // in ensureValidToken does not null it out.
      refresh_token: refreshToken,
      expires_in: parsed.data.expires_in,
    };
  } catch (error) {
    console.error(
      "[refreshYouTubeToken] Refresh error:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
