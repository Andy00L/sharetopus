import "server-only";

import { z } from "zod";

import { META_GRAPH_API_VERSION } from "@/lib/api/_shared/metaGraphApiVersion";
import { requestCodeExchange } from "@/lib/api/oauth/requestCodeExchange";
import type { TokenExchangeResult } from "@/lib/types/dbTypes";

// Facebook documents long-lived user tokens as lasting about 60 days:
// https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
const LONG_LIVED_FALLBACK_SECONDS = 60 * 24 * 60 * 60;

/**
 * /oauth/access_token response (both code exchange and fb_exchange_token).
 * sourceRef: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
 */
const FacebookTokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
});

export async function exchangeFacebookCode(
  code: string,
  redirectUri: string,
): Promise<TokenExchangeResult> {
  const clientId = process.env.FACEBOOK_CLIENT_ID;
  const clientSecret = process.env.FACEBOOK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("[exchangeFacebookCode] Facebook configuration missing.");
    return { success: false, message: "Facebook configuration missing." };
  }

  const graphTokenUrl = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/oauth/access_token`;

  const shortLived = await requestCodeExchange({
    caller: "exchangeFacebookCode",
    platformLabel: "Facebook",
    url: `${graphTokenUrl}?${new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    })}`,
    method: "GET",
    schema: FacebookTokenSchema,
  });
  if (!shortLived.ok) return { success: false, message: shortLived.message };

  const longLived = await requestCodeExchange({
    caller: "exchangeFacebookCode",
    platformLabel: "Facebook",
    url: `${graphTokenUrl}?${new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: clientId,
      client_secret: clientSecret,
      fb_exchange_token: shortLived.answer.access_token,
    })}`,
    method: "GET",
    schema: FacebookTokenSchema,
  });
  if (!longLived.ok) return { success: false, message: longLived.message };

  return {
    success: true,
    data: {
      access_token: longLived.answer.access_token,
      expires_in: longLived.answer.expires_in ?? LONG_LIVED_FALLBACK_SECONDS,
      token_type: longLived.answer.token_type,
    },
  };
}
