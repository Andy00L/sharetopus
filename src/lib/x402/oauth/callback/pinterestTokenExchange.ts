import "server-only";

export interface PinterestExchangeResult {
  ok: true;
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  accountIdentifier: string;
  profile: {
    name?: string;
    avatarUrl?: string;
    username?: string;
  };
}

export type ExchangePinterestForX402Result =
  | PinterestExchangeResult
  | { ok: false; error: "exchange_failed" | "profile_fetch_failed"; message: string };

/**
 * Exchange Pinterest OAuth code for access token + profile.
 *
 * Inlines the exchange logic because exchangePinterestCode hardcodes
 * PINTEREST_REDIRECT_URL. This uses X402_PINTEREST_REDIRECT_URI.
 * Pinterest uses Basic Auth (client_id:client_secret) for token exchange.
 */
export async function exchangePinterestForX402(
  code: string
): Promise<ExchangePinterestForX402Result> {
  const clientId = process.env.PINTEREST_CLIENT_ID;
  const clientSecret = process.env.PINTEREST_CLIENT_SECRET;
  const redirectUri = process.env.X402_PINTEREST_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    console.error("[exchangePinterestForX402] Missing Pinterest env vars.");
    return {
      ok: false,
      error: "exchange_failed",
      message: "Pinterest configuration missing.",
    };
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );

  const params = new URLSearchParams();
  params.append("grant_type", "authorization_code");
  params.append("code", code);
  params.append("redirect_uri", redirectUri);

  let tokenData: Record<string, unknown>;
  try {
    const response = await fetch(
      "https://api.pinterest.com/v5/oauth/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`,
        },
        body: params.toString(),
      }
    );

    const text = await response.text();
    if (!response.ok) {
      console.error(`[exchangePinterestForX402] Token exchange failed (${response.status}): ${text}`);
      return {
        ok: false,
        error: "exchange_failed",
        message: `Pinterest token exchange failed (${response.status}).`,
      };
    }

    tokenData = JSON.parse(text);
  } catch (err) {
    console.error("[exchangePinterestForX402] Token exchange error:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: "exchange_failed",
      message: "Pinterest token exchange request failed.",
    };
  }

  const accessToken = tokenData.access_token as string | undefined;
  if (!accessToken) {
    return {
      ok: false,
      error: "exchange_failed",
      message: "Missing access_token in Pinterest response.",
    };
  }

  // Fetch profile
  let profile: Record<string, unknown> = {};
  try {
    const profileResponse = await fetch(
      "https://api.pinterest.com/v5/user_account",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (profileResponse.ok) {
      profile = (await profileResponse.json()) as Record<string, unknown>;
    }
  } catch {
    // Profile fetch is best-effort
  }

  const accountId =
    (profile.id as string) ??
    (tokenData.response_type as string) ??
    "";

  return {
    ok: true,
    accessToken,
    refreshToken: (tokenData.refresh_token as string) ?? null,
    expiresIn: (tokenData.expires_in as number) ?? 2592000,
    accountIdentifier: accountId,
    profile: {
      name: profile.business_name as string | undefined,
      avatarUrl: profile.profile_image as string | undefined,
      username: profile.username as string | undefined,
    },
  };
}
