import "server-only";

import { z } from "zod";

/** Outbound provider calls are bounded. */
const EXCHANGE_TIMEOUT_MS = 15_000;

/**
 * Instagram returns either { data: [{ access_token, user_id, ... }] } or a
 * flat object, and user_id arrives as a string or number depending on the
 * API surface; both are normalized below.
 */
const InstagramTokenEntrySchema = z.object({
  access_token: z.string().min(1),
  user_id: z.union([z.string().min(1), z.number()]),
});

const InstagramLongLivedSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().optional(),
});

export interface InstagramExchangeResult {
  ok: true;
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  accountIdentifier: string;
  profile: {
    name?: string;
    username?: string;
    avatarUrl?: string;
    userId?: string;
  };
}

export type ExchangeInstagramForX402Result =
  | InstagramExchangeResult
  | { ok: false; error: "exchange_failed" | "profile_fetch_failed"; message: string };

/**
 * Exchange an Instagram OAuth code for an access token + profile.
 *
 * Two-phase exchange (mirrors exchangeInstagramCode, the web flow):
 *   1. Short-lived token from api.instagram.com/oauth/access_token
 *   2. Long-lived token swap via graph.instagram.com/access_token
 *      (best-effort; the short-lived token works for ~1 hour)
 *
 * Uses X402_INSTAGRAM_REDIRECT_URI instead of INSTAGRAM_REDIRECT_URL. The
 * profile fetch is best-effort: the account identifier (user_id) already
 * comes from the token response.
 *
 * Called by: handleOAuthCallback
 */
export async function exchangeInstagramForX402(
  code: string
): Promise<ExchangeInstagramForX402Result> {
  const clientId = process.env.INSTAGRAM_CLIENT_ID;
  const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET;
  const redirectUri = process.env.X402_INSTAGRAM_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    console.error("[exchangeInstagramForX402] Missing Instagram env vars.");
    return {
      ok: false,
      error: "exchange_failed",
      message: "Instagram configuration missing.",
    };
  }

  // Phase 1: Exchange code for short-lived token
  const params = new URLSearchParams();
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);
  params.append("grant_type", "authorization_code");
  params.append("redirect_uri", redirectUri);
  params.append("code", code);

  let shortLivedToken: string;
  let userId: string;
  try {
    const response = await fetch(
      "https://api.instagram.com/oauth/access_token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
      }
    );

    const text = await response.text();
    if (!response.ok) {
      console.error(`[exchangeInstagramForX402] Short-lived token exchange failed (${response.status}): ${text}`);
      return {
        ok: false,
        error: "exchange_failed",
        message: `Instagram token exchange failed (${response.status}).`,
      };
    }

    const rawBody = JSON.parse(text) as Record<string, unknown>;
    const tokenEntryCandidate = Array.isArray(rawBody.data)
      ? rawBody.data[0]
      : rawBody;
    const parsed = InstagramTokenEntrySchema.safeParse(tokenEntryCandidate);
    if (!parsed.success) {
      console.error("[exchangeInstagramForX402] Token response failed validation (missing access_token or user_id).");
      return {
        ok: false,
        error: "exchange_failed",
        message: "Instagram token response had an unexpected shape.",
      };
    }
    shortLivedToken = parsed.data.access_token;
    userId = String(parsed.data.user_id);
  } catch (err) {
    console.error("[exchangeInstagramForX402] Token exchange error:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: "exchange_failed",
      message: "Instagram token exchange request failed.",
    };
  }

  // Phase 2: Exchange for long-lived token (60 days). Best-effort.
  let longLivedToken = shortLivedToken;
  let expiresIn = 3600;

  try {
    const longLivedUrl =
      `https://graph.instagram.com/access_token` +
      `?grant_type=ig_exchange_token` +
      `&client_secret=${encodeURIComponent(clientSecret)}` +
      `&access_token=${encodeURIComponent(shortLivedToken)}`;

    const llResponse = await fetch(longLivedUrl, {
      method: "GET",
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });

    if (llResponse.ok) {
      const parsed = InstagramLongLivedSchema.safeParse(
        JSON.parse(await llResponse.text())
      );
      if (parsed.success) {
        longLivedToken = parsed.data.access_token;
        expiresIn = parsed.data.expires_in ?? 5184000; // 60 days
      }
    } else {
      console.warn("[exchangeInstagramForX402] Long-lived token swap failed; using short-lived token.");
    }
  } catch (err) {
    console.warn("[exchangeInstagramForX402] Long-lived token swap error:", err instanceof Error ? err.message : err);
  }

  // Fetch profile. Best-effort: display fields only.
  let profile: Record<string, unknown> = {};
  try {
    const profileResponse = await fetch(
      `https://graph.instagram.com/v21.0/me?fields=user_id,username,name,profile_picture_url&access_token=${encodeURIComponent(longLivedToken)}`,
      { signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS) }
    );

    if (profileResponse.ok) {
      profile = (await profileResponse.json()) as Record<string, unknown>;
    }
  } catch (err) {
    // Best-effort: the identifier is already known from the token response.
    console.warn("[exchangeInstagramForX402] Profile fetch failed (continuing without display fields):", err instanceof Error ? err.message : err);
  }

  return {
    ok: true,
    accessToken: longLivedToken,
    refreshToken: null, // Instagram Login does not provide refresh tokens
    expiresIn,
    accountIdentifier: userId,
    profile: {
      name: typeof profile.name === "string" ? profile.name : undefined,
      username: typeof profile.username === "string" ? profile.username : undefined,
      avatarUrl: typeof profile.profile_picture_url === "string" ? profile.profile_picture_url : undefined,
      userId,
    },
  };
}
