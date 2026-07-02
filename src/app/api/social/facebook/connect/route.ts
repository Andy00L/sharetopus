import { completeWebOAuthConnect } from "@/lib/api/oauth/web/completeWebOAuthConnect";
import { exchangeFacebookCode } from "@/lib/api/facebook/data/exchangeFacebookCode";
import { getFacebookPages } from "@/lib/api/facebook/data/getFacebookPages";
import type { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/social/facebook/connect?code=...&state=...
 *
 * Popup callback for the Facebook web connect flow: exchanges the code for
 * a long-lived user token, lists every managed Page, and stores ONE
 * social_accounts row PER PAGE. Page tokens minted from a long-lived user
 * token do not expire, so tokenExpiresAt is null.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return completeWebOAuthConnect(request, {
    platform: "facebook",
    stateCookieName: "facebook_auth_state",
    successCallbackName: "onFacebookConnectSuccess",
    failureCallbackName: "onFacebookConnectFailure",
    exchangeAndFetchAccounts: async (code) => {
      const exchangeResult = await exchangeFacebookCode(code);
      if (!exchangeResult.success) {
        return { success: false, message: exchangeResult.message };
      }

      const pagesResult = await getFacebookPages(
        exchangeResult.data.access_token,
      );
      if (!pagesResult.success) {
        return { success: false, message: pagesResult.message };
      }

      return {
        success: true,
        accounts: pagesResult.pages.map((page) => ({
          accountIdentifier: page.pageId,
          displayName: page.name,
          username: page.name,
          avatarUrl: page.avatarUrl,
          emailAddress: null,
          // The PAGE token is what every publish call uses; the user token
          // is intentionally not stored anywhere.
          accessToken: page.pageAccessToken,
          refreshToken: null,
          tokenExpiresAt: null,
          extra: {
            category: page.category,
          },
        })),
      };
    },
  });
}
