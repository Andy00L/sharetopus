import { completeWebOAuthConnect } from "@/lib/api/oauth/web/completeWebOAuthConnect";
import type { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/social/x/connect?code=...&state=...
 *
 * Popup callback for the X web connect flow. Sends the PKCE verifier from
 * the cookie and stores the user keyed on its X user id. The exchange and
 * profile read live in connectPlatformAccounts, shared with the x402/REST
 * callback.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return completeWebOAuthConnect(request, {
    platform: "x",
    stateCookieName: "x_auth_state",
    verifierCookieName: "x_auth_verifier",
    successCallbackName: "onXConnectSuccess",
    failureCallbackName: "onXConnectFailure",
    redirectUri: process.env.X_REDIRECT_URL,
  });
}
