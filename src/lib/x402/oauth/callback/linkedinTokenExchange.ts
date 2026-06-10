import "server-only";

import { z } from "zod";

/** Outbound provider calls are bounded; LinkedIn occasionally stalls. */
const EXCHANGE_TIMEOUT_MS = 15_000;

const LinkedInTokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
});

const LinkedInProfileSchema = z.object({
  sub: z.string().min(1),
  name: z.string().optional(),
  email: z.string().optional(),
  picture: z.string().optional(),
});

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
 * Exchange a LinkedIn OAuth code for an access token + profile.
 *
 * Separate from exchangeLinkedInCode (the web flow) because that function
 * hardcodes LINKEDIN_REDIRECT_URL (the Clerk callback); this one uses
 * X402_LINKEDIN_REDIRECT_URI. The profile fetch is REQUIRED: the account
 * identifier (OpenID sub) comes from it.
 *
 * Called by: handleOAuthCallback
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

  let tokenData: z.infer<typeof LinkedInTokenSchema>;
  try {
    const response = await fetch(
      "https://www.linkedin.com/oauth/v2/accessToken",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
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

    const parsed = LinkedInTokenSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      console.error("[exchangeLinkedInForX402] Token response failed validation.");
      return {
        ok: false,
        error: "exchange_failed",
        message: "LinkedIn token response had an unexpected shape.",
      };
    }
    tokenData = parsed.data;
  } catch (err) {
    console.error("[exchangeLinkedInForX402] Token exchange error:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: "exchange_failed",
      message: "LinkedIn token exchange request failed.",
    };
  }

  // Fetch profile via /v2/userinfo (OpenID Connect); sub is the identifier.
  let profile: z.infer<typeof LinkedInProfileSchema>;
  try {
    const profileResponse = await fetch(
      "https://api.linkedin.com/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
        signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
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

    const parsed = LinkedInProfileSchema.safeParse(await profileResponse.json());
    if (!parsed.success) {
      console.error("[exchangeLinkedInForX402] Profile response failed validation (missing sub).");
      return {
        ok: false,
        error: "profile_fetch_failed",
        message: "LinkedIn profile response had an unexpected shape.",
      };
    }
    profile = parsed.data;
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
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? null,
    expiresIn: tokenData.expires_in ?? 3600,
    accountIdentifier: profile.sub,
    profile: {
      name: profile.name,
      email: profile.email,
      avatarUrl: profile.picture,
      sub: profile.sub,
    },
  };
}
