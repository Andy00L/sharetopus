import { initiateWebOAuth } from "@/lib/api/oauth/web/initiateWebOAuth";
import type { NextResponse } from "next/server";

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
