import { completeWebOAuthConnect } from "@/lib/api/oauth/web/completeWebOAuthConnect";
import { exchangeYouTubeCode } from "@/lib/api/youtube/data/exchangeYouTubeCode";
import { getYouTubeProfile } from "@/lib/api/youtube/data/getYouTubeProfile";
import type { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/social/youtube/connect?code=...&state=...
 *
 * Popup callback for the YouTube web connect flow: exchanges the Google
 * code, reads the channel, and stores it as the social account.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return completeWebOAuthConnect(request, {
    platform: "youtube",
    stateCookieName: "youtube_auth_state",
    successCallbackName: "onYouTubeConnectSuccess",
    failureCallbackName: "onYouTubeConnectFailure",
    exchangeAndFetchAccounts: async (code) => {
      const exchangeResult = await exchangeYouTubeCode(code);
      if (!exchangeResult.success) {
        return { success: false, message: exchangeResult.message };
      }
      const tokens = exchangeResult.data;

      const profileResult = await getYouTubeProfile(tokens.access_token);
      if (!profileResult.success) {
        return { success: false, message: profileResult.message };
      }
      const channel = profileResult.data;

      const tokenExpiresAt = new Date(
        Date.now() + tokens.expires_in * 1000,
      ).toISOString();

      return {
        success: true,
        accounts: [
          {
            accountIdentifier: channel.channelId,
            displayName: channel.title,
            username: channel.customUrl ?? channel.title,
            avatarUrl: channel.avatarUrl,
            emailAddress: null,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token ?? null,
            tokenExpiresAt,
            extra: {
              scope: tokens.scope ?? null,
              subscriber_count: channel.subscriberCount,
            },
          },
        ],
      };
    },
  });
}
