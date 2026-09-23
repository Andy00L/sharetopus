import { completeWebOAuthConnect } from "@/lib/api/oauth/web/completeWebOAuthConnect";
import { exchangeTikTokCode } from "@/lib/api/tiktok/data/exchangeTikTokCode";
import { getTikTokProfile } from "@/lib/api/tiktok/data/getTikTokProfile";
import type { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/social/tiktok/connect?code=...&state=...
 *
 * Popup callback for the TikTok web connect flow: exchanges the code, reads
 * the creator profile, and stores it as the social account. The open_id
 * from the token response is the identity, so a creator who withheld the
 * profile scopes still connects, with placeholder profile fields.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return completeWebOAuthConnect(request, {
    platform: "tiktok",
    stateCookieName: "tiktok_auth_state",
    successCallbackName: "onTikTokConnectSuccess",
    failureCallbackName: "onTikTokConnectFailure",
    exchangeAndFetchAccounts: async (code) => {
      const exchangeResult = await exchangeTikTokCode(code);
      if (!exchangeResult.success) {
        return { success: false, message: exchangeResult.message };
      }
      const tokens = exchangeResult.data;
      if (!tokens.open_id) {
        return { success: false, message: "TikTok returned no account id." };
      }

      // Never throws: a failed call returns placeholder fields.
      const profile = await getTikTokProfile(tokens.access_token, tokens.open_id);

      return {
        success: true,
        accounts: [
          {
            accountIdentifier: tokens.open_id,
            displayName: profile.display_name,
            username: profile.username,
            avatarUrl: profile.avatar_url,
            emailAddress: null,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token ?? null,
            tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
            profileStats: {
              isVerified: profile.is_verified,
              bioDescription: profile.bio_description,
              followerCount: profile.follower_count,
              followingCount: profile.following_count,
            },
            extra: {
              profile,
              token_info: {
                scope: tokens.scope ?? null,
                token_type: tokens.token_type ?? null,
                refresh_expires_in: tokens.refresh_expires_in ?? null,
              },
            },
          },
        ],
      };
    },
  });
}
