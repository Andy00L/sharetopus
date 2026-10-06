import { completeWebOAuthConnect } from "@/lib/api/oauth/web/completeWebOAuthConnect";
import type { NextRequest, NextResponse } from "next/server";

/** OAuth popup callback for the Instagram web connect flow. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return completeWebOAuthConnect(request, {
    platform: "instagram",
    stateCookieName: "instagram_auth_state",
    redirectUri: process.env.INSTAGRAM_REDIRECT_URL,
  });
}
