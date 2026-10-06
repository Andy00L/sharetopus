import { completeWebOAuthConnect } from "@/lib/api/oauth/web/completeWebOAuthConnect";
import type { NextRequest, NextResponse } from "next/server";

/** OAuth popup callback for the LinkedIn web connect flow. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return completeWebOAuthConnect(request, {
    platform: "linkedin",
    stateCookieName: "linkedin_auth_state",
    redirectUri: process.env.LINKEDIN_REDIRECT_URL,
  });
}
