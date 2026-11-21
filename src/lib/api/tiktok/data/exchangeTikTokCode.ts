import "server-only";

import { z } from "zod";

import { requestCodeExchange } from "@/lib/api/oauth/requestCodeExchange";
import { readTikTokClientCredentials } from "@/lib/api/tiktok/data/readTikTokClientCredentials";
import type { TokenExchangeResult } from "@/lib/types/dbTypes";

/**
 * TikTok token endpoint answer. open_id is the creator's identity, and the
 * account row is keyed on it.
 * sourceRef: https://developers.tiktok.com/doc/oauth-user-access-token-management
 */
const TikTokTokenSchema = z.object({
  access_token: z.string().min(1),
  open_id: z.string().min(1),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  refresh_expires_in: z.number().optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

export async function exchangeTikTokCode(
  code: string,
  redirectUri: string,
): Promise<TokenExchangeResult> {
  const credentials = readTikTokClientCredentials();
  if (!credentials) {
    console.error("[exchangeTikTokCode] TikTok configuration missing.");
    return { success: false, message: "TikTok configuration missing." };
  }

  const exchanged = await requestCodeExchange({
    caller: "exchangeTikTokCode",
    platformLabel: "TikTok",
    url: "https://open.tiktokapis.com/v2/oauth/token/",
    method: "POST",
    body: new URLSearchParams({
      client_key: credentials.clientKey,
      client_secret: credentials.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
    schema: TikTokTokenSchema,
  });
  if (!exchanged.ok) return { success: false, message: exchanged.message };
  return { success: true, data: exchanged.answer };
}
