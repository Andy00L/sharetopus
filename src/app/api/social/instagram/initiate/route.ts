import { initiateWebOAuth } from "@/lib/api/oauth/web/initiateWebOAuth";
import type { NextResponse } from "next/server";

/**
 * POST /api/social/instagram/initiate
 *
 * Starts the Instagram Login popup flow (Instagram API with Instagram
 * Login, not Facebook Login: enable_fb_login=0). The instagram_business_*
 * scopes replaced the old ones on January 27, 2025.
 */
export async function POST(): Promise<NextResponse> {
  return initiateWebOAuth({
    platform: "instagram",
    stateCookieName: "instagram_auth_state",
    buildAuthorizeUrl: (state) => {
      const clientId = process.env.INSTAGRAM_CLIENT_ID;
      const redirectUri = process.env.INSTAGRAM_REDIRECT_URL;
      if (!clientId) {
        return { ok: false, message: "INSTAGRAM_CLIENT_ID is not configured." };
      }
      if (!redirectUri) {
        return { ok: false, message: "INSTAGRAM_REDIRECT_URL is not configured." };
      }

      const scopes = [
        "instagram_business_basic",
        "instagram_business_content_publish",
      ].join(",");
      const url =
        `https://www.instagram.com/oauth/authorize` +
        `?client_id=${clientId}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&state=${state}` +
        `&enable_fb_login=0` +
        `&force_authentication=1`;

      return { ok: true, url };
    },
  });
}
