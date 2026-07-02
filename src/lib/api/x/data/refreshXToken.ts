import "server-only";

import { z } from "zod";

import type { TokenExchangeResponse } from "@/lib/types/dbTypes";
import { buildBasicAuthHeader } from "./exchangeXCode";

/** Outbound X OAuth calls are bounded to 15s. */
const REFRESH_TIMEOUT_MS = 15_000;

/**
 * Token endpoint response for grant_type=refresh_token. X rotates the
 * refresh token: every refresh returns a NEW refresh_token and the old one
 * stops working, so the caller must persist the returned value.
 * sourceRef: https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token
 */
const XRefreshSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
});

/**
 * Refresh an expired X access token. Requires the offline.access scope on
 * the original grant. Returns null on any failure so ensureValidToken can
 * surface its generic "please reconnect" message.
 *
 * Called by: ensureValidToken (case "x")
 */
export default async function refreshXToken(
  refreshToken: string,
): Promise<TokenExchangeResponse | null> {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("[refreshXToken] X configuration missing.");
    return null;
  }

  const params = new URLSearchParams();
  params.append("grant_type", "refresh_token");
  params.append("refresh_token", refreshToken);
  params.append("client_id", clientId);

  try {
    const response = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: buildBasicAuthHeader(clientId, clientSecret),
      },
      body: params.toString(),
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(
        `[refreshXToken] Refresh failed (${response.status}): ${responseText}`,
      );
      return null;
    }

    const parsed = XRefreshSchema.safeParse(JSON.parse(responseText));
    if (!parsed.success) {
      console.error("[refreshXToken] Refresh response failed validation.");
      return null;
    }

    return {
      access_token: parsed.data.access_token,
      // Rotated by X; fall back to the old one only if the response
      // unexpectedly omits it.
      refresh_token: parsed.data.refresh_token ?? refreshToken,
      expires_in: parsed.data.expires_in,
    };
  } catch (error) {
    console.error(
      "[refreshXToken] Refresh error:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
