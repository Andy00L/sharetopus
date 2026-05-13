import "server-only";

export interface LinkedInExchangeResult {
  ok: true;
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  accountIdentifier: string;
  profile: {
    name?: string;
    email?: string;
    avatarUrl?: string;
    sub?: string;
  };
}

export type ExchangeLinkedInForX402Result =
  | LinkedInExchangeResult
  | { ok: false; error: "exchange_failed" | "profile_fetch_failed"; message: string };

/**
 * Exchange LinkedIn OAuth code for access token + profile.
 *
 * Inlines the exchange logic from exchangeLinkedInCode because that function
 * hardcodes LINKEDIN_REDIRECT_URL (the Clerk callback). This uses
 * X402_LINKEDIN_REDIRECT_URI instead.
 */
export async function exchangeLinkedInForX402(
  code: string
): Promise<ExchangeLinkedInForX402Result> {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirectUri = process.env.X402_LINKEDIN_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    console.error("[exchangeLinkedInForX402] Missing LinkedIn env vars.");
    return {
      ok: false,
      error: "exchange_failed",
      message: "LinkedIn configuration missing.",
    };
  }

  // Exchange code for tokens
  const params = new URLSearchParams();
  params.append("grant_type", "authorization_code");
  params.append("code", code);
  params.append("redirect_uri", redirectUri);
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);

  let tokenData: Record<string, unknown>;
  try {
    const response = await fetch(
      "https://www.linkedin.com/oauth/v2/accessToken",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      }
    );

    const text = await response.text();
    if (!response.ok) {
      console.error(`[exchangeLinkedInForX402] Token exchange failed (${response.status}): ${text}`);
      return {
        ok: false,
        error: "exchange_failed",
        message: `LinkedIn token exchange failed (${response.status}).`,
      };
    }

    tokenData = JSON.parse(text);
  } catch (err) {
    console.error("[exchangeLinkedInForX402] Token exchange error:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: "exchange_failed",
      message: "LinkedIn token exchange request failed.",
    };
  }

  const accessToken = tokenData.access_token as string | undefined;
  if (!accessToken) {
    return {
      ok: false,
      error: "exchange_failed",
      message: "Missing access_token in LinkedIn response.",
    };
  }

  // Fetch profile via /v2/userinfo (OpenID Connect)
  let profile: Record<string, unknown>;
  try {
    const profileResponse = await fetch(
      "https://api.linkedin.com/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!profileResponse.ok) {
      console.error(`[exchangeLinkedInForX402] Profile fetch failed (${profileResponse.status})`);
      return {
        ok: false,
        error: "profile_fetch_failed",
        message: "Failed to fetch LinkedIn profile.",
      };
    }

    profile = (await profileResponse.json()) as Record<string, unknown>;
  } catch (err) {
    console.error("[exchangeLinkedInForX402] Profile fetch error:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: "profile_fetch_failed",
      message: "LinkedIn profile fetch request failed.",
    };
  }

  return {
    ok: true,
    accessToken,
    refreshToken: (tokenData.refresh_token as string) ?? null,
    expiresIn: (tokenData.expires_in as number) ?? 3600,
    accountIdentifier: (profile.sub as string) ?? "",
    profile: {
      name: profile.name as string | undefined,
      email: profile.email as string | undefined,
      avatarUrl: profile.picture as string | undefined,
      sub: profile.sub as string | undefined,
    },
  };
}
