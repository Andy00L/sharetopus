import "server-only";

import { z } from "zod";

/** Outbound provider calls are bounded. */
const EXCHANGE_TIMEOUT_MS = 15_000;

const TikTokTokenSchema = z.object({
  access_token: z.string().min(1),
  open_id: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
});

export interface TikTokExchangeResult {
  ok: true;
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  accountIdentifier: string;
  profile: {
    name?: string;
    avatarUrl?: string;
    openId?: string;
  };
}

export type ExchangeTikTokForX402Result =
  | TikTokExchangeResult
  | { ok: false; error: "exchange_failed" | "profile_fetch_failed"; message: string };

/**
 * Exchange a TikTok OAuth code for an access token + profile.
 *
 * Separate from exchangeTikTokCode (the web flow), which hardcodes
 * TIKTOK_REDIRECT_URL; this one uses X402_TIKTOK_REDIRECT_URI. The profile
 * fetch is best-effort: the account identifier (open_id) already comes from
 * the token response, so a profile failure only loses display fields.
 *
 * Called by: handleOAuthCallback
 */
export async function exchangeTikTokForX402(
  code: string
): Promise<ExchangeTikTokForX402Result> {
  const clientKey =
    process.env.NODE_ENV === "development"
      ? process.env.TIKTOK_CLIENT_KEY_DEV
      : process.env.TIKTOK_CLIENT_KEY;

  const clientSecret =
    process.env.NODE_ENV === "development"
      ? process.env.TIKTOK_CLIENT_SECRET_DEV
      : process.env.TIKTOK_CLIENT_SECRET;

  const redirectUri = process.env.X402_TIKTOK_REDIRECT_URI;

  if (!clientKey || !clientSecret || !redirectUri) {
    console.error("[exchangeTikTokForX402] Missing TikTok env vars.");
    return {
      ok: false,
      error: "exchange_failed",
      message: "TikTok configuration missing.",
    };
  }

  const params = new URLSearchParams();
  params.append("client_key", clientKey);
  params.append("client_secret", clientSecret);
  params.append("code", code);
  params.append("grant_type", "authorization_code");
  params.append("redirect_uri", redirectUri);

  let tokenData: z.infer<typeof TikTokTokenSchema>;
  try {
    const response = await fetch(
      "https://open.tiktokapis.com/v2/oauth/token/",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
      }
    );

    const text = await response.text();
    if (!response.ok) {
      console.error(`[exchangeTikTokForX402] Token exchange failed (${response.status}): ${text}`);
      return {
        ok: false,
        error: "exchange_failed",
        message: `TikTok token exchange failed (${response.status}).`,
      };
    }

    const parsed = TikTokTokenSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      console.error("[exchangeTikTokForX402] Token response failed validation (missing access_token or open_id).");
      return {
        ok: false,
        error: "exchange_failed",
        message: "TikTok token response had an unexpected shape.",
      };
    }
    tokenData = parsed.data;
  } catch (err) {
    console.error("[exchangeTikTokForX402] Token exchange error:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: "exchange_failed",
      message: "TikTok token exchange request failed.",
    };
  }

  // Fetch basic profile. Best-effort: display fields only.
  let profile: Record<string, unknown> = {};
  try {
    const profileResponse = await fetch(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url",
      {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
        signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
      }
    );

    if (profileResponse.ok) {
      const profileBody = (await profileResponse.json()) as Record<string, unknown>;
      const userData = (profileBody.data as Record<string, unknown> | undefined)
        ?.user as Record<string, unknown> | undefined;
      if (userData) profile = userData;
    }
  } catch (err) {
    // Best-effort: the identifier is already known from the token response.
    console.warn("[exchangeTikTokForX402] Profile fetch failed (continuing without display fields):", err instanceof Error ? err.message : err);
  }

  return {
    ok: true,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? null,
    expiresIn: tokenData.expires_in ?? 86400,
    accountIdentifier: tokenData.open_id,
    profile: {
      name: typeof profile.display_name === "string" ? profile.display_name : undefined,
      avatarUrl: typeof profile.avatar_url === "string" ? profile.avatar_url : undefined,
      openId: tokenData.open_id,
    },
  };
}
