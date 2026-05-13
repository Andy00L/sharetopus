import "server-only";

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
 * Exchange TikTok OAuth code for access token + profile.
 *
 * Inlines the exchange logic because exchangeTikTokCode hardcodes
 * TIKTOK_REDIRECT_URL. This uses X402_TIKTOK_REDIRECT_URI.
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

  let tokenData: Record<string, unknown>;
  try {
    const response = await fetch(
      "https://open.tiktokapis.com/v2/oauth/token/",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
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

    tokenData = JSON.parse(text);
  } catch (err) {
    console.error("[exchangeTikTokForX402] Token exchange error:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: "exchange_failed",
      message: "TikTok token exchange request failed.",
    };
  }

  const accessToken = tokenData.access_token as string | undefined;
  const openId = tokenData.open_id as string | undefined;

  if (!accessToken || !openId) {
    return {
      ok: false,
      error: "exchange_failed",
      message: "Missing access_token or open_id in TikTok response.",
    };
  }

  // Fetch basic profile
  let profile: Record<string, unknown> = {};
  try {
    const profileResponse = await fetch(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (profileResponse.ok) {
      const profileBody = (await profileResponse.json()) as Record<string, unknown>;
      const userData = (profileBody.data as Record<string, unknown>)?.user as Record<string, unknown> | undefined;
      if (userData) profile = userData;
    }
  } catch {
    // Profile fetch is best-effort for TikTok
  }

  return {
    ok: true,
    accessToken,
    refreshToken: (tokenData.refresh_token as string) ?? null,
    expiresIn: (tokenData.expires_in as number) ?? 86400,
    accountIdentifier: openId,
    profile: {
      name: profile.display_name as string | undefined,
      avatarUrl: profile.avatar_url as string | undefined,
      openId,
    },
  };
}
