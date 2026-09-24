import { completeWebOAuthConnect } from "@/lib/api/oauth/web/completeWebOAuthConnect";
import type { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/social/facebook/connect?code=...&state=...
 *
 * Popup callback for the Facebook web connect flow. Stores ONE
 * social_accounts row PER managed Page, each with its non-expiring Page
 * token. The exchange and Page listing live in connectPlatformAccounts,
 * shared with the x402/REST callback.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return completeWebOAuthConnect(request, {
    platform: "facebook",
    stateCookieName: "facebook_auth_state",
    successCallbackName: "onFacebookConnectSuccess",
    failureCallbackName: "onFacebookConnectFailure",
    redirectUri: process.env.FACEBOOK_REDIRECT_URL,
  });
}
