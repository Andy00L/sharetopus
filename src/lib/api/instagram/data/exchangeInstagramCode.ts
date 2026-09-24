import "server-only";

import { z } from "zod";

import { requestCodeExchange } from "@/lib/api/oauth/requestCodeExchange";
import type { TokenExchangeResult } from "@/lib/types/dbTypes";

/** 60 days in seconds, the documented long-lived token lifetime. */
const LONG_LIVED_FALLBACK_SECONDS = 60 * 24 * 60 * 60;

/**
 * One short-lived token entry. user_id arrives as a string or a number
 * depending on the API surface; it is normalized to a string below.
 */
const InstagramTokenEntrySchema = z.object({
  access_token: z.string().min(1),
  user_id: z.union([z.string().min(1), z.number()]),
  permissions: z.union([z.string(), z.array(z.string())]).optional(),
});

/** The short-lived answer is { data: [entry] } or the entry itself. */
const InstagramShortLivedSchema = z.union([
  z.object({ data: z.array(InstagramTokenEntrySchema).nonempty() }),
  InstagramTokenEntrySchema,
]);

/**
 * grant_type=ig_exchange_token answer.
 * sourceRef: https://developers.facebook.com/docs/instagram-platform/reference/access_token
 */
const InstagramLongLivedSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().optional(),
});

/**
 * Exchanges an Instagram Login code for a LONG-LIVED access token.
 *
 * Two phases:
 *   1. code -> short-lived token (1 hour) from api.instagram.com
 *   2. short-lived -> long-lived token (60 days) from graph.instagram.com
 *
 * Phase 2 is required: refreshInstagramToken can only renew a long-lived
 * token, so a stored short-lived one would die within the hour with no way
 * back. Instagram Login issues no refresh token at all; the answer carries
 * none, where this function used to return the string "null".
 *
 * `redirectUri` must be the exact URI the authorize URL carried.
 *
 * Called by: connectPlatformAccounts
 */
export async function exchangeInstagramCode(
  code: string,
  redirectUri: string,
): Promise<TokenExchangeResult> {
  const clientId = process.env.INSTAGRAM_CLIENT_ID;
  const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("[exchangeInstagramCode] Instagram configuration missing.");
    return { success: false, message: "Instagram configuration missing." };
  }

  const shortLived = await requestCodeExchange({
    caller: "exchangeInstagramCode",
    platformLabel: "Instagram",
    url: "https://api.instagram.com/oauth/access_token",
    method: "POST",
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    }),
    schema: InstagramShortLivedSchema,
  });
  if (!shortLived.ok) return { success: false, message: shortLived.message };
  const tokenEntry =
    "data" in shortLived.answer ? shortLived.answer.data[0] : shortLived.answer;

  const longLived = await requestCodeExchange({
    caller: "exchangeInstagramCode",
    platformLabel: "Instagram",
    url: `https://graph.instagram.com/access_token?${new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: clientSecret,
      access_token: tokenEntry.access_token,
    })}`,
    method: "GET",
    schema: InstagramLongLivedSchema,
  });
  if (!longLived.ok) return { success: false, message: longLived.message };

  return {
    success: true,
    data: {
      access_token: longLived.answer.access_token,
      expires_in: longLived.answer.expires_in ?? LONG_LIVED_FALLBACK_SECONDS,
      user_id: String(tokenEntry.user_id),
      scope: Array.isArray(tokenEntry.permissions)
        ? tokenEntry.permissions.join(",")
        : tokenEntry.permissions,
    },
  };
}
