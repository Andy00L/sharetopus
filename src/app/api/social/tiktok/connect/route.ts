import { completeWebOAuthConnect } from "@/lib/api/oauth/web/completeWebOAuthConnect";
import type { NextRequest, NextResponse } from "next/server";

/** OAuth popup callback for the TikTok web connect flow. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return completeWebOAuthConnect(request, {
    platform: "tiktok",
    stateCookieName: "tiktok_auth_state",
    redirectUri: process.env.TIKTOK_REDIRECT_URL,
  });
}
