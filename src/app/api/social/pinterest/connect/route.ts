import { completeWebOAuthConnect } from "@/lib/api/oauth/web/completeWebOAuthConnect";
import { exchangePinterestCode } from "@/lib/api/pinterest/data/exchangePinterestCode";
import { getPinterestProfile } from "@/lib/api/pinterest/data/getPinterestProfile";
import type { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/social/pinterest/connect?code=...&state=...
 *
 * Popup callback for the Pinterest web connect flow: exchanges the code,
 * reads the account, and stores it as the social account. The account id
 * is its identity, so a profile that cannot be read fails the connect
 * instead of storing an account with an empty identifier.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return completeWebOAuthConnect(request, {
    platform: "pinterest",
    stateCookieName: "pinterest_auth_state",
    successCallbackName: "onPinterestConnectSuccess",
    failureCallbackName: "onPinterestConnectFailure",
    exchangeAndFetchAccounts: async (code) => {
      const exchangeResult = await exchangePinterestCode(code);
      if (!exchangeResult.success) {
        return { success: false, message: exchangeResult.message };
      }
      const tokens = exchangeResult.data;

      // Never throws: a failed call returns a placeholder with an empty id.
      const profile = await getPinterestProfile(tokens.access_token);
      if (!profile.id) {
        return { success: false, message: "Could not read the Pinterest account." };
      }

      return {
        success: true,
        accounts: [
          {
            accountIdentifier: profile.id,
            displayName: profile.business_name || profile.username || null,
            username: profile.username || null,
            avatarUrl: profile.profile_image_url,
            emailAddress: null,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token ?? null,
            tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
            profileStats: {
              isVerified: profile.is_verified,
              bioDescription: profile.bio,
              followerCount: profile.follower_count,
              followingCount: profile.following_count,
            },
            extra: {
              profile,
              token_info: {
                scope: tokens.scope ?? null,
                token_type: tokens.token_type ?? null,
              },
            },
          },
        ],
      };
    },
  });
}
