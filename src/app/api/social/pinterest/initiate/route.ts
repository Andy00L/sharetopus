import { initiateWebOAuth } from "@/lib/api/oauth/web/initiateWebOAuth";
import type { NextResponse } from "next/server";

/**
 * POST /api/social/pinterest/initiate
 *
 * Starts the Pinterest OAuth popup flow. The web flow also asks for the
 * catalogs:* scopes, which buildOAuthUrl (the x402 flow) leaves out.
 */
export async function POST(): Promise<NextResponse> {
  return initiateWebOAuth({
    platform: "pinterest",
    stateCookieName: "pinterest_auth_state",
    buildAuthorizeUrl: (state) => {
      const clientId = process.env.PINTEREST_CLIENT_ID;
      const redirectUri = process.env.PINTEREST_REDIRECT_URL;
      if (!clientId) {
        return { ok: false, message: "PINTEREST_CLIENT_ID is not configured." };
      }
      if (!redirectUri) {
        return { ok: false, message: "PINTEREST_REDIRECT_URL is not configured." };
      }

      const scopes = [
        "boards:read",
        "boards:write",
        "pins:read",
        "pins:write",
        "user_accounts:read",
        "catalogs:read",
        "catalogs:write",
      ].join(",");
      const url =
        `https://www.pinterest.com/oauth/` +
        `?client_id=${clientId}` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&state=${state}` +
        `&response_type=code` +
        `&prompt=login` +
        `&auth_type=reauthenticate`;

      return { ok: true, url };
    },
  });
}
