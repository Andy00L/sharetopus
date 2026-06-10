import "server-only";

import { z } from "zod";

/** Outbound provider calls are bounded. */
const EXCHANGE_TIMEOUT_MS = 15_000;

const PinterestTokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
});

const PinterestProfileSchema = z.object({
  id: z.string().min(1),
  business_name: z.string().optional(),
  profile_image: z.string().optional(),
  username: z.string().optional(),
});

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
 * Exchange a Pinterest OAuth code for an access token + profile.
 *
 * Separate from exchangePinterestCode (the web flow), which hardcodes
 * PINTEREST_REDIRECT_URL; this one uses X402_PINTEREST_REDIRECT_URI.
 * Pinterest uses Basic Auth (client_id:client_secret) for the exchange.
 * The profile fetch is REQUIRED: the account identifier comes from it, and
 * an account row with an empty identifier would collide on upsert.
 *
 * Called by: handleOAuthCallback
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

  let tokenData: z.infer<typeof PinterestTokenSchema>;
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
        signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
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

    const parsed = PinterestTokenSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      console.error("[exchangePinterestForX402] Token response failed validation.");
      return {
        ok: false,
        error: "exchange_failed",
        message: "Pinterest token response had an unexpected shape.",
      };
    }
    tokenData = parsed.data;
  } catch (err) {
    console.error("[exchangePinterestForX402] Token exchange error:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: "exchange_failed",
      message: "Pinterest token exchange request failed.",
    };
  }

  // Fetch the user account; its id is the account identifier.
  let profile: z.infer<typeof PinterestProfileSchema>;
  try {
    const profileResponse = await fetch(
      "https://api.pinterest.com/v5/user_account",
      {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
        signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
      }
    );

    if (!profileResponse.ok) {
      console.error(`[exchangePinterestForX402] Profile fetch failed (${profileResponse.status})`);
      return {
        ok: false,
        error: "profile_fetch_failed",
        message: "Failed to fetch Pinterest profile.",
      };
    }

    const parsed = PinterestProfileSchema.safeParse(await profileResponse.json());
    if (!parsed.success) {
      console.error("[exchangePinterestForX402] Profile response failed validation (missing id).");
      return {
        ok: false,
        error: "profile_fetch_failed",
        message: "Pinterest profile response had an unexpected shape.",
      };
    }
    profile = parsed.data;
  } catch (err) {
    console.error("[exchangePinterestForX402] Profile fetch error:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: "profile_fetch_failed",
      message: "Pinterest profile fetch request failed.",
    };
  }

  return {
    ok: true,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? null,
    expiresIn: tokenData.expires_in ?? 2592000,
    accountIdentifier: profile.id,
    profile: {
      name: profile.business_name,
      avatarUrl: profile.profile_image,
      username: profile.username,
    },
  };
}
