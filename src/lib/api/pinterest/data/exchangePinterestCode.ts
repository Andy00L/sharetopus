import "server-only";

import { z } from "zod";

import { buildBasicAuthHeader } from "@/lib/api/oauth/buildBasicAuthHeader";
import { requestCodeExchange } from "@/lib/api/oauth/requestCodeExchange";
import type { TokenExchangeResult } from "@/lib/types/dbTypes";

/**
 * Pinterest token endpoint answer for grant_type=authorization_code.
 * sourceRef: https://developers.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/
 */
const PinterestTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

/**
 * Exchanges a Pinterest authorization code for tokens. The app
 * authenticates with HTTP Basic, as refreshPinterestToken does.
 * `redirectUri` must be the exact URI the authorize URL carried.
 *
 * Called by: connectPlatformAccounts
 */
export async function exchangePinterestCode(
  code: string,
  redirectUri: string,
): Promise<TokenExchangeResult> {
  const clientId = process.env.PINTEREST_CLIENT_ID;
  const clientSecret = process.env.PINTEREST_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("[exchangePinterestCode] Pinterest configuration missing.");
    return { success: false, message: "Pinterest configuration missing." };
  }

  const exchanged = await requestCodeExchange({
    caller: "exchangePinterestCode",
    platformLabel: "Pinterest",
    url: "https://api.pinterest.com/v5/oauth/token",
    method: "POST",
    headers: { Authorization: buildBasicAuthHeader(clientId, clientSecret) },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
    schema: PinterestTokenSchema,
  });
  if (!exchanged.ok) return { success: false, message: exchanged.message };
  return { success: true, data: exchanged.answer };
}
