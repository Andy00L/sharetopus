import "server-only";

import { z } from "zod";

import type { TokenExchangeResponse } from "@/lib/types/dbTypes";

/** Outbound Instagram Graph calls are bounded to 15s. */
const REFRESH_TIMEOUT_MS = 15_000;

/**
 * /refresh_access_token response.
 * sourceRef: https://developers.facebook.com/docs/instagram-platform/reference/refresh_access_token
 */
const InstagramRefreshSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().optional(),
});

/** 60 days in seconds, the documented long-lived token lifetime. */
const LONG_LIVED_FALLBACK_SECONDS = 60 * 24 * 60 * 60;

/**
 * Refresh an Instagram LONG-LIVED access token before it expires.
 *
 * Instagram Login has no refresh_token: the long-lived ACCESS token itself
 * is exchanged for a fresh 60-day one, so the caller passes the current
 * access token (not social_accounts.refresh_token). Instagram requires the
 * token to be at least 24 hours old and still valid; an expired token
 * cannot be refreshed and the user must reconnect.
 *
 * Called by: ensureValidToken (case "instagram")
 */
export default async function refreshInstagramToken(
  longLivedAccessToken: string,
): Promise<TokenExchangeResponse | null> {
  if (!longLivedAccessToken) {
    console.error("[refreshInstagramToken] Missing access token.");
    return null;
  }

  const url =
    `https://graph.instagram.com/refresh_access_token` +
    `?grant_type=ig_refresh_token` +
    `&access_token=${encodeURIComponent(longLivedAccessToken)}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(
        `[refreshInstagramToken] Refresh failed (${response.status}): ${responseText}`,
      );
      return null;
    }

    const parsed = InstagramRefreshSchema.safeParse(JSON.parse(responseText));
    if (!parsed.success) {
      console.error(
        "[refreshInstagramToken] Refresh response failed validation.",
      );
      return null;
    }

    return {
      access_token: parsed.data.access_token,
      expires_in: parsed.data.expires_in ?? LONG_LIVED_FALLBACK_SECONDS,
    };
  } catch (error) {
    console.error(
      "[refreshInstagramToken] Refresh error:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
