import "server-only";

import { z } from "zod";

import type {
  TokenExchangeResponse,
  TokenExchangeResult,
} from "@/lib/types/dbTypes";

/** Outbound Google OAuth calls are bounded to 15s, matching the x402 exchange wrappers. */
const EXCHANGE_TIMEOUT_MS = 15_000;

/**
 * Google token endpoint response for grant_type=authorization_code.
 * sourceRef: https://developers.google.com/identity/protocols/oauth2/web-server#exchange-authorization-code
 */
const GoogleTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

/**
 * Exchange a Google OAuth code for YouTube tokens (web connect flow).
 *
 * Uses YOUTUBE_REDIRECT_URL (the /api/social/youtube/connect callback). The
 * refresh_token is only present when the authorize URL was built with
 * access_type=offline and prompt=consent; initiateWebOAuth sets both.
 *
 * Called by: /api/social/youtube/connect
 */
export async function exchangeYouTubeCode(
  code: string,
): Promise<TokenExchangeResult> {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const redirectUri = process.env.YOUTUBE_REDIRECT_URL;

  if (!clientId || !clientSecret || !redirectUri) {
    console.error("[exchangeYouTubeCode] YouTube configuration missing.");
    return {
      success: false,
      message: "YouTube configuration missing. Check environment variables.",
    };
  }

  // sourceRef: https://developers.google.com/identity/protocols/oauth2/web-server
  const tokenUrl = "https://oauth2.googleapis.com/token";

  const params = new URLSearchParams();
  params.append("grant_type", "authorization_code");
  params.append("code", code);
  params.append("redirect_uri", redirectUri);
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);

  try {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(
        `[exchangeYouTubeCode] HTTP ${response.status}: ${responseText}`,
      );
      return {
        success: false,
        message: `YouTube code exchange failed (${response.status}).`,
      };
    }

    const parsed = GoogleTokenSchema.safeParse(JSON.parse(responseText));
    if (!parsed.success) {
      console.error(
        "[exchangeYouTubeCode] Token response failed validation (missing access_token or expires_in).",
      );
      return {
        success: false,
        message: "YouTube token response had an unexpected shape.",
      };
    }

    const tokenResponse: TokenExchangeResponse = {
      access_token: parsed.data.access_token,
      refresh_token: parsed.data.refresh_token,
      expires_in: parsed.data.expires_in,
      scope: parsed.data.scope,
      token_type: parsed.data.token_type,
    };

    return { success: true, data: tokenResponse };
  } catch (error) {
    console.error(
      "[exchangeYouTubeCode] Token exchange error:",
      error instanceof Error ? error.message : error,
    );
    return {
      success: false,
      message: "YouTube token exchange request failed.",
    };
  }
}
