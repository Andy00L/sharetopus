import { completeWebOAuthConnect } from "@/lib/api/oauth/web/completeWebOAuthConnect";
import type { NextRequest, NextResponse } from "next/server";

/** OAuth popup callback for the YouTube web connect flow. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return completeWebOAuthConnect(request, {
    platform: "youtube",
    stateCookieName: "youtube_auth_state",
    redirectUri: process.env.YOUTUBE_REDIRECT_URL,
  });
}
