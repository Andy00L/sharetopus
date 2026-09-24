import { completeWebOAuthConnect } from "@/lib/api/oauth/web/completeWebOAuthConnect";
import type { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/social/pinterest/connect?code=...&state=...
 *
 * Popup callback for the Pinterest web connect flow. Stores the account
 * keyed on its Pinterest account id. The exchange and profile read live in
 * connectPlatformAccounts, shared with the x402/REST callback.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return completeWebOAuthConnect(request, {
    platform: "pinterest",
    stateCookieName: "pinterest_auth_state",
    successCallbackName: "onPinterestConnectSuccess",
    failureCallbackName: "onPinterestConnectFailure",
    redirectUri: process.env.PINTEREST_REDIRECT_URL,
  });
}
