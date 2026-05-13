import "server-only";

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
 * Exchange Instagram OAuth code for access token + profile.
 *
 * Two-phase exchange (mirrors exchangeInstagramCode):
 *   1. Short-lived token from api.instagram.com/oauth/access_token
 *   2. Long-lived token swap via graph.instagram.com/access_token
 *
 * Uses X402_INSTAGRAM_REDIRECT_URI instead of INSTAGRAM_REDIRECT_URL.
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

  let shortLivedData: Record<string, unknown>;
  try {
    const response = await fetch(
      "https://api.instagram.com/oauth/access_token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
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

    shortLivedData = JSON.parse(text);
  } catch (err) {
    console.error("[exchangeInstagramForX402] Token exchange error:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: "exchange_failed",
      message: "Instagram token exchange request failed.",
    };
  }

  // Instagram returns { data: [{ access_token, user_id, permissions }] } or flat object
  const tokenEntry =
    (shortLivedData.data as Record<string, unknown>[] | undefined)?.[0] ??
    shortLivedData;

  const shortLivedToken = tokenEntry.access_token as string | undefined;
  const userId = tokenEntry.user_id as string | undefined;

  if (!shortLivedToken || !userId) {
    return {
      ok: false,
      error: "exchange_failed",
      message: "Missing access_token or user_id in Instagram response.",
    };
  }

  // Phase 2: Exchange for long-lived token (60 days)
  let longLivedToken = shortLivedToken;
  let expiresIn = 3600;

  try {
    const longLivedUrl =
      `https://graph.instagram.com/access_token` +
      `?grant_type=ig_exchange_token` +
      `&client_secret=${encodeURIComponent(clientSecret)}` +
      `&access_token=${encodeURIComponent(shortLivedToken)}`;

    const llResponse = await fetch(longLivedUrl, { method: "GET" });

    if (llResponse.ok) {
      const llText = await llResponse.text();
      const llData = JSON.parse(llText) as Record<string, unknown>;
      if (llData.access_token) {
        longLivedToken = llData.access_token as string;
        expiresIn = (llData.expires_in as number) ?? 5184000; // 60 days
      }
    } else {
      console.warn("[exchangeInstagramForX402] Long-lived token swap failed; using short-lived token.");
    }
  } catch (err) {
    console.warn("[exchangeInstagramForX402] Long-lived token swap error:", err instanceof Error ? err.message : err);
  }

  // Fetch profile
  let profile: Record<string, unknown> = {};
  try {
    const profileResponse = await fetch(
      `https://graph.instagram.com/v21.0/me?fields=user_id,username,name,profile_picture_url&access_token=${encodeURIComponent(longLivedToken)}`
    );

    if (profileResponse.ok) {
      profile = (await profileResponse.json()) as Record<string, unknown>;
    }
  } catch {
    // Profile fetch is best-effort
  }

  return {
    ok: true,
    accessToken: longLivedToken,
    refreshToken: null, // Instagram Login does not provide refresh tokens
    expiresIn,
    accountIdentifier: userId,
    profile: {
      name: profile.name as string | undefined,
      username: profile.username as string | undefined,
      avatarUrl: profile.profile_picture_url as string | undefined,
      userId,
    },
  };
}
