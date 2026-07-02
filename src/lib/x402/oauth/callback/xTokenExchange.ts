import "server-only";

import { z } from "zod";

import { buildBasicAuthHeader } from "@/lib/api/x/data/exchangeXCode";
import { getXProfile } from "@/lib/api/x/data/getXProfile";

/** Outbound provider calls are bounded. */
const EXCHANGE_TIMEOUT_MS = 15_000;

/**
 * X token endpoint response (authorization_code grant with PKCE).
 * sourceRef: https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token
 */
const XTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
});

export interface XExchangeResult {
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

export type ExchangeXForX402Result =
  | XExchangeResult
  | { ok: false; error: "exchange_failed" | "profile_fetch_failed"; message: string };

/**
 * Exchange an X OAuth code for tokens + user profile.
 *
 * X mandates PKCE, so the caller must pass the code_verifier that the
 * connect flow stored in social_connections.oauth_code_verifier. Uses
 * X402_X_REDIRECT_URI instead of X_REDIRECT_URL (the web popup flow).
 * The profile fetch is REQUIRED: the account identifier (user id) comes
 * from it.
 *
 * Called by: handleOAuthCallback
 */
export async function exchangeXForX402(
  code: string,
  codeVerifier: string | null,
): Promise<ExchangeXForX402Result> {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  const redirectUri = process.env.X402_X_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    console.error("[exchangeXForX402] Missing X env vars.");
    return {
      ok: false,
      error: "exchange_failed",
      message: "X configuration missing.",
    };
  }

  if (!codeVerifier) {
    console.error(
      "[exchangeXForX402] Missing PKCE verifier on the connection row.",
    );
    return {
      ok: false,
      error: "exchange_failed",
      message: "Missing PKCE verifier for the X token exchange.",
    };
  }

  const params = new URLSearchParams();
  params.append("grant_type", "authorization_code");
  params.append("code", code);
  params.append("redirect_uri", redirectUri);
  params.append("code_verifier", codeVerifier);
  params.append("client_id", clientId);

  let tokenData: z.infer<typeof XTokenSchema>;
  try {
    const response = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: buildBasicAuthHeader(clientId, clientSecret),
      },
      body: params.toString(),
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });

    const text = await response.text();
    if (!response.ok) {
      console.error(
        `[exchangeXForX402] Token exchange failed (${response.status}): ${text}`,
      );
      return {
        ok: false,
        error: "exchange_failed",
        message: `X token exchange failed (${response.status}).`,
      };
    }

    const parsed = XTokenSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      console.error("[exchangeXForX402] Token response failed validation.");
      return {
        ok: false,
        error: "exchange_failed",
        message: "X token response had an unexpected shape.",
      };
    }
    tokenData = parsed.data;
  } catch (err) {
    console.error(
      "[exchangeXForX402] Token exchange error:",
      err instanceof Error ? err.message : err,
    );
    return {
      ok: false,
      error: "exchange_failed",
      message: "X token exchange request failed.",
    };
  }

  // Profile fetch is required: the user id is the account identifier.
  const profileResult = await getXProfile(tokenData.access_token);
  if (!profileResult.success) {
    return {
      ok: false,
      error: "profile_fetch_failed",
      message: profileResult.message,
    };
  }
  const user = profileResult.data;

  return {
    ok: true,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? null,
    expiresIn: tokenData.expires_in,
    accountIdentifier: user.id,
    profile: {
      name: user.name,
      username: user.username,
      avatarUrl: user.avatarUrl ?? undefined,
    },
  };
}
