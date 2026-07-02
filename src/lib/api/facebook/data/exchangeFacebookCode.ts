import "server-only";

import { z } from "zod";

import type {
  TokenExchangeResponse,
  TokenExchangeResult,
} from "@/lib/types/dbTypes";

/** Outbound Graph API calls are bounded to 15s. */
const EXCHANGE_TIMEOUT_MS = 15_000;

/**
 * Graph API version pinned across the repo; postToInstagram.ts pins the
 * same version on graph.instagram.com.
 */
const GRAPH_API_VERSION = "v23.0";

/**
 * /oauth/access_token response (both code exchange and fb_exchange_token).
 * sourceRef: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
 */
const FacebookTokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
});

/**
 * Exchange a Facebook Login code for a LONG-LIVED USER token (web flow).
 *
 * Two phases:
 *   1. code -> short-lived user token (GET /oauth/access_token)
 *   2. short-lived -> long-lived user token (grant_type=fb_exchange_token)
 *
 * The returned token is the USER token. Page tokens (what posting actually
 * uses) are derived from it via getFacebookPages; page tokens minted from a
 * long-lived user token do not expire.
 * sourceRef: https://developers.facebook.com/docs/pages-api/getting-started/
 *
 * Called by: /api/social/facebook/connect, facebookTokenExchange (x402 flow)
 */
export async function exchangeFacebookCode(
  code: string,
  redirectUriOverride?: string,
): Promise<TokenExchangeResult> {
  const clientId = process.env.FACEBOOK_CLIENT_ID;
  const clientSecret = process.env.FACEBOOK_CLIENT_SECRET;
  const redirectUri = redirectUriOverride ?? process.env.FACEBOOK_REDIRECT_URL;

  if (!clientId || !clientSecret || !redirectUri) {
    console.error("[exchangeFacebookCode] Facebook configuration missing.");
    return {
      success: false,
      message: "Facebook configuration missing. Check environment variables.",
    };
  }

  // Phase 1: code -> short-lived user token.
  let shortLivedToken: string;
  try {
    const codeExchangeUrl =
      `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&client_secret=${encodeURIComponent(clientSecret)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&code=${encodeURIComponent(code)}`;

    const response = await fetch(codeExchangeUrl, {
      method: "GET",
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });

    const responseText = await response.text();
    if (!response.ok) {
      console.error(
        `[exchangeFacebookCode] Code exchange failed (${response.status}): ${responseText}`,
      );
      return {
        success: false,
        message: `Facebook code exchange failed (${response.status}).`,
      };
    }

    const parsed = FacebookTokenSchema.safeParse(JSON.parse(responseText));
    if (!parsed.success) {
      console.error(
        "[exchangeFacebookCode] Code exchange response failed validation.",
      );
      return {
        success: false,
        message: "Facebook token response had an unexpected shape.",
      };
    }
    shortLivedToken = parsed.data.access_token;
  } catch (error) {
    console.error(
      "[exchangeFacebookCode] Code exchange error:",
      error instanceof Error ? error.message : error,
    );
    return {
      success: false,
      message: "Facebook token exchange request failed.",
    };
  }

  // Phase 2: short-lived -> long-lived user token (about 60 days).
  try {
    const longLivedUrl =
      `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token` +
      `?grant_type=fb_exchange_token` +
      `&client_id=${encodeURIComponent(clientId)}` +
      `&client_secret=${encodeURIComponent(clientSecret)}` +
      `&fb_exchange_token=${encodeURIComponent(shortLivedToken)}`;

    const response = await fetch(longLivedUrl, {
      method: "GET",
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });

    const responseText = await response.text();
    if (!response.ok) {
      console.error(
        `[exchangeFacebookCode] Long-lived exchange failed (${response.status}): ${responseText}`,
      );
      return {
        success: false,
        message: `Facebook long-lived token exchange failed (${response.status}).`,
      };
    }

    const parsed = FacebookTokenSchema.safeParse(JSON.parse(responseText));
    if (!parsed.success) {
      console.error(
        "[exchangeFacebookCode] Long-lived response failed validation.",
      );
      return {
        success: false,
        message: "Facebook long-lived token response had an unexpected shape.",
      };
    }

    // 60 days in seconds, the documented long-lived user token lifetime.
    const LONG_LIVED_FALLBACK_SECONDS = 60 * 24 * 60 * 60;
    const tokenResponse: TokenExchangeResponse = {
      access_token: parsed.data.access_token,
      expires_in: parsed.data.expires_in ?? LONG_LIVED_FALLBACK_SECONDS,
      token_type: parsed.data.token_type,
    };

    return { success: true, data: tokenResponse };
  } catch (error) {
    console.error(
      "[exchangeFacebookCode] Long-lived exchange error:",
      error instanceof Error ? error.message : error,
    );
    return {
      success: false,
      message: "Facebook long-lived token exchange request failed.",
    };
  }
}
