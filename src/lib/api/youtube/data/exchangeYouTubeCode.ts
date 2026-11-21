import "server-only";

import { z } from "zod";

import { requestCodeExchange } from "@/lib/api/oauth/requestCodeExchange";
import type { TokenExchangeResult } from "@/lib/types/dbTypes";

/**
 * Google token endpoint answer for grant_type=authorization_code.
 * sourceRef: https://developers.google.com/identity/protocols/oauth2/web-server#exchange-authorization-code
 */
const GoogleTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

export async function exchangeYouTubeCode(
  code: string,
  redirectUri: string,
): Promise<TokenExchangeResult> {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("[exchangeYouTubeCode] YouTube configuration missing.");
    return { success: false, message: "YouTube configuration missing." };
  }

  const exchanged = await requestCodeExchange({
    caller: "exchangeYouTubeCode",
    platformLabel: "YouTube",
    url: "https://oauth2.googleapis.com/token",
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    schema: GoogleTokenSchema,
  });
  if (!exchanged.ok) return { success: false, message: exchanged.message };
  return { success: true, data: exchanged.answer };
}
