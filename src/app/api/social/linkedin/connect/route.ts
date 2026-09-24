import { completeWebOAuthConnect } from "@/lib/api/oauth/web/completeWebOAuthConnect";
import type { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/social/linkedin/connect?code=...&state=...
 *
 * Popup callback for the LinkedIn web connect flow. Stores the member keyed
 * on the OpenID sub. The exchange and profile read live in
 * connectPlatformAccounts, shared with the x402/REST callback.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return completeWebOAuthConnect(request, {
    platform: "linkedin",
    stateCookieName: "linkedin_auth_state",
    successCallbackName: "onLinkedInConnectSuccess",
    failureCallbackName: "onLinkedInConnectFailure",
    redirectUri: process.env.LINKEDIN_REDIRECT_URL,
  });
}
