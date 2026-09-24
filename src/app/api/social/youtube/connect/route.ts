import { completeWebOAuthConnect } from "@/lib/api/oauth/web/completeWebOAuthConnect";
import type { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/social/youtube/connect?code=...&state=...
 *
 * Popup callback for the YouTube web connect flow. Stores the channel keyed
 * on its channel id. The exchange and profile read live in
 * connectPlatformAccounts, shared with the x402/REST callback.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return completeWebOAuthConnect(request, {
    platform: "youtube",
    stateCookieName: "youtube_auth_state",
    successCallbackName: "onYouTubeConnectSuccess",
    failureCallbackName: "onYouTubeConnectFailure",
    redirectUri: process.env.YOUTUBE_REDIRECT_URL,
  });
}
