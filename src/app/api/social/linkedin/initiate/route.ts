import { initiateWebOAuth } from "@/lib/api/oauth/web/initiateWebOAuth";
import type { NextResponse } from "next/server";

/**
 * POST /api/social/linkedin/initiate
 *
 * Starts the LinkedIn OAuth popup flow. openid + profile return the OpenID
 * sub the account is keyed on, email fills its email address, and
 * w_member_social posts.
 * sourceRef: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
 */
export async function POST(): Promise<NextResponse> {
  return initiateWebOAuth({
    platform: "linkedin",
    stateCookieName: "linkedin_auth_state",
    buildAuthorizeUrl: (state) => {
      const clientId = process.env.LINKEDIN_CLIENT_ID;
      const redirectUri = process.env.LINKEDIN_REDIRECT_URL;
      if (!clientId) {
        return { ok: false, message: "LINKEDIN_CLIENT_ID is not configured." };
      }
      if (!redirectUri) {
        return { ok: false, message: "LINKEDIN_REDIRECT_URL is not configured." };
      }

      const scopes = ["openid", "profile", "email", "w_member_social"].join(" ");
      const url =
        `https://www.linkedin.com/oauth/v2/authorization` +
        `?client_id=${clientId}` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&state=${state}` +
        `&response_type=code` +
        `&prompt=consent_and_login` +
        `&auth_type=reauthenticate`;

      return { ok: true, url };
    },
  });
}
