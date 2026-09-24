import { completeWebOAuthConnect } from "@/lib/api/oauth/web/completeWebOAuthConnect";
import type { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/social/instagram/connect?code=...&state=...
 *
 * Popup callback for the Instagram web connect flow. Stores the
 * professional account keyed on its /me user_id. The exchange and profile
 * read live in connectPlatformAccounts, shared with the x402/REST callback.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return completeWebOAuthConnect(request, {
    platform: "instagram",
    stateCookieName: "instagram_auth_state",
    successCallbackName: "onInstagramConnectSuccess",
    failureCallbackName: "onInstagramConnectFailure",
    redirectUri: process.env.INSTAGRAM_REDIRECT_URL,
  });
}
