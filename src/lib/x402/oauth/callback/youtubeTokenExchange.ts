import "server-only";

import { z } from "zod";

import { getYouTubeProfile } from "@/lib/api/youtube/data/getYouTubeProfile";

/** Outbound provider calls are bounded. */
const EXCHANGE_TIMEOUT_MS = 15_000;

/**
 * Google token endpoint response (authorization_code grant).
 * sourceRef: https://developers.google.com/identity/protocols/oauth2/web-server
 */
const YouTubeTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
});

export interface YouTubeExchangeResult {
  ok: true;
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  accountIdentifier: string;
  profile: {
    name?: string;
    username?: string;
    avatarUrl?: string;
  };
}

export type ExchangeYouTubeForX402Result =
  | YouTubeExchangeResult
  | { ok: false; error: "exchange_failed" | "profile_fetch_failed"; message: string };

/**
 * Exchange a YouTube (Google) OAuth code for tokens + channel profile.
 *
 * Separate from exchangeYouTubeCode (the web flow) because that function
 * uses YOUTUBE_REDIRECT_URL (the popup callback); this one uses
 * X402_YOUTUBE_REDIRECT_URI. The channel fetch is REQUIRED: the account
 * identifier (channel id) comes from it.
 *
 * Called by: handleOAuthCallback
 */
export async function exchangeYouTubeForX402(
  code: string,
): Promise<ExchangeYouTubeForX402Result> {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const redirectUri = process.env.X402_YOUTUBE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    console.error("[exchangeYouTubeForX402] Missing YouTube env vars.");
    return {
      ok: false,
      error: "exchange_failed",
      message: "YouTube configuration missing.",
    };
  }

  const params = new URLSearchParams();
  params.append("grant_type", "authorization_code");
  params.append("code", code);
  params.append("redirect_uri", redirectUri);
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);

  let tokenData: z.infer<typeof YouTubeTokenSchema>;
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });

    const text = await response.text();
    if (!response.ok) {
      console.error(
        `[exchangeYouTubeForX402] Token exchange failed (${response.status}): ${text}`,
      );
      return {
        ok: false,
        error: "exchange_failed",
        message: `YouTube token exchange failed (${response.status}).`,
      };
    }

    const parsed = YouTubeTokenSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      console.error(
        "[exchangeYouTubeForX402] Token response failed validation.",
      );
      return {
        ok: false,
        error: "exchange_failed",
        message: "YouTube token response had an unexpected shape.",
      };
    }
    tokenData = parsed.data;
  } catch (err) {
    console.error(
      "[exchangeYouTubeForX402] Token exchange error:",
      err instanceof Error ? err.message : err,
    );
    return {
      ok: false,
      error: "exchange_failed",
      message: "YouTube token exchange request failed.",
    };
  }

  // Channel fetch is required: channel id is the account identifier.
  const profileResult = await getYouTubeProfile(tokenData.access_token);
  if (!profileResult.success) {
    return {
      ok: false,
      error: "profile_fetch_failed",
      message: profileResult.message,
    };
  }
  const channel = profileResult.data;

  return {
    ok: true,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? null,
    expiresIn: tokenData.expires_in,
    accountIdentifier: channel.channelId,
    profile: {
      name: channel.title,
      username: channel.customUrl ?? channel.title,
      avatarUrl: channel.avatarUrl ?? undefined,
    },
  };
}
