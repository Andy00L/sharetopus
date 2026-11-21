import { completeWebOAuthConnect } from "@/lib/api/oauth/web/completeWebOAuthConnect";
import type { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest): Promise<NextResponse> {
  return completeWebOAuthConnect(request, {
    platform: "tiktok",
    stateCookieName: "tiktok_auth_state",
    redirectUri: process.env.TIKTOK_REDIRECT_URL,
  });
}
