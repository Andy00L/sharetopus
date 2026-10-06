import { completeWebOAuthConnect } from "@/lib/api/oauth/web/completeWebOAuthConnect";
import type { NextRequest, NextResponse } from "next/server";

/** OAuth popup callback for the Pinterest web connect flow. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return completeWebOAuthConnect(request, {
    platform: "pinterest",
    stateCookieName: "pinterest_auth_state",
    redirectUri: process.env.PINTEREST_REDIRECT_URL,
  });
}
