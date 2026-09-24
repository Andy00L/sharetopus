import { completeWebOAuthConnect } from "@/lib/api/oauth/web/completeWebOAuthConnect";
import type { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/social/tiktok/connect?code=...&state=...
 *
 * Popup callback for the TikTok web connect flow. Stores the creator keyed
 * on the open_id from the token answer. The exchange and profile read live
 * in connectPlatformAccounts, shared with the x402/REST callback.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return completeWebOAuthConnect(request, {
    platform: "tiktok",
    stateCookieName: "tiktok_auth_state",
    successCallbackName: "onTikTokConnectSuccess",
    failureCallbackName: "onTikTokConnectFailure",
    redirectUri: process.env.TIKTOK_REDIRECT_URL,
  });
}
