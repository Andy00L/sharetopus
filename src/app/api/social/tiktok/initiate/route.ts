import { initiateWebOAuth } from "@/lib/api/oauth/web/initiateWebOAuth";
import type { NextResponse } from "next/server";

/**
 * POST /api/social/tiktok/initiate
 *
 * Starts the TikTok OAuth popup flow. Development builds use the sandbox
 * client (TIKTOK_CLIENT_KEY_DEV). The URL matches buildOAuthUrl's TikTok
 * URL (the x402 flow) apart from the redirect URI.
 */
export async function POST(): Promise<NextResponse> {
  return initiateWebOAuth({
    platform: "tiktok",
    stateCookieName: "tiktok_auth_state",
    buildAuthorizeUrl: (state) => {
      const clientKey =
        process.env.NODE_ENV === "development"
          ? process.env.TIKTOK_CLIENT_KEY_DEV
          : process.env.TIKTOK_CLIENT_KEY;
      const redirectUri = process.env.TIKTOK_REDIRECT_URL;
      if (!clientKey) {
        return { ok: false, message: "TIKTOK_CLIENT_KEY is not configured." };
      }
      if (!redirectUri) {
        return { ok: false, message: "TIKTOK_REDIRECT_URL is not configured." };
      }

      const scopes =
        "user.info.basic,user.info.profile,video.publish,video.upload,user.info.stats";
      const url =
        `https://www.tiktok.com/v2/auth/authorize/` +
        `?client_key=${clientKey}` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&state=${state}` +
        `&response_type=code` +
        `&force_login=true` +
        `&auth_type=reauthenticate` +
        `&timestamp=${Date.now()}`;

      return { ok: true, url };
    },
  });
}
