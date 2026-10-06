import { completeWebOAuthConnect } from "@/lib/api/oauth/web/completeWebOAuthConnect";
import type { NextRequest, NextResponse } from "next/server";

/** OAuth popup callback for the Facebook web connect flow; stores one row per managed Page. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return completeWebOAuthConnect(request, {
    platform: "facebook",
    stateCookieName: "facebook_auth_state",
    redirectUri: process.env.FACEBOOK_REDIRECT_URL,
  });
}
