import "server-only";

import { z } from "zod";

import { requestCodeExchange } from "@/lib/api/oauth/requestCodeExchange";
import type { TokenExchangeResult } from "@/lib/types/dbTypes";

/**
 * LinkedIn token endpoint answer for grant_type=authorization_code. Every
 * access token is issued with expires_in (60 days); refresh_token comes
 * only to apps approved for programmatic refresh.
 * sourceRef: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
 */
const LinkedInTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
});

/**
 * Exchanges a LinkedIn authorization code for tokens. `redirectUri` must be
 * the exact URI the authorize URL carried.
 *
 * Called by: connectPlatformAccounts
 */
export async function exchangeLinkedInCode(
  code: string,
  redirectUri: string,
): Promise<TokenExchangeResult> {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("[exchangeLinkedInCode] LinkedIn configuration missing.");
    return { success: false, message: "LinkedIn configuration missing." };
  }

  const exchanged = await requestCodeExchange({
    caller: "exchangeLinkedInCode",
    platformLabel: "LinkedIn",
    url: "https://www.linkedin.com/oauth/v2/accessToken",
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    schema: LinkedInTokenSchema,
  });
  if (!exchanged.ok) return { success: false, message: exchanged.message };
  return { success: true, data: exchanged.answer };
}
