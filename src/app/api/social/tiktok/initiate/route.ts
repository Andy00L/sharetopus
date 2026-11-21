import { initiateWebOAuth } from "@/lib/api/oauth/web/initiateWebOAuth";
import { buildOAuthUrl } from "@/lib/x402/connect/buildOAuthUrl";
import type { NextResponse } from "next/server";

export async function POST(): Promise<NextResponse> {
  return initiateWebOAuth({
    platform: "tiktok",
    stateCookieName: "tiktok_auth_state",
    buildAuthorizeUrl: (state) => {
      const redirectUri = process.env.TIKTOK_REDIRECT_URL;
      if (!redirectUri) {
        return { ok: false, message: "TIKTOK_REDIRECT_URL is not configured." };
      }

      const urlResult = buildOAuthUrl({ platform: "tiktok", state, redirectUri });
      return urlResult.ok
        ? { ok: true, url: urlResult.url }
        : { ok: false, message: urlResult.message };
    },
  });
}
