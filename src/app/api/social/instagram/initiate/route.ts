import { initiateWebOAuth } from "@/lib/api/oauth/web/initiateWebOAuth";
import type { NextResponse } from "next/server";

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
      // enable_fb_login=0 hides the Facebook Login option on the Instagram login page:
      // https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
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
