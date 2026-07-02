import { initiateWebOAuth } from "@/lib/api/oauth/web/initiateWebOAuth";
import type { NextResponse } from "next/server";

/**
 * POST /api/social/x/initiate
 *
 * Starts the X OAuth 2.0 popup flow. X mandates PKCE, so initiateWebOAuth
 * mints a code_verifier cookie and passes the S256 challenge here.
 * sourceRef: https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token
 */
export async function POST(): Promise<NextResponse> {
  return initiateWebOAuth({
    platform: "x",
    stateCookieName: "x_auth_state",
    verifierCookieName: "x_auth_verifier",
    buildAuthorizeUrl: (state, codeChallenge) => {
      const clientId = process.env.X_CLIENT_ID;
      const redirectUri = process.env.X_REDIRECT_URL;
      if (!clientId) {
        return { ok: false, message: "X_CLIENT_ID is not configured." };
      }
      if (!redirectUri) {
        return { ok: false, message: "X_REDIRECT_URL is not configured." };
      }
      if (!codeChallenge) {
        return {
          ok: false,
          message: "PKCE challenge missing for the X authorize URL.",
        };
      }

      // tweet.write publishes; media.write uploads media; offline.access
      // issues the (rotating) refresh token.
      const scopes = [
        "tweet.read",
        "tweet.write",
        "users.read",
        "media.write",
        "offline.access",
      ].join(" ");

      const url =
        `https://x.com/i/oauth2/authorize` +
        `?response_type=code` +
        `&client_id=${clientId}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&state=${state}` +
        `&code_challenge=${codeChallenge}` +
        `&code_challenge_method=S256`;

      return { ok: true, url };
    },
  });
}
