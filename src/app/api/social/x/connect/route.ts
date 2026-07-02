import { completeWebOAuthConnect } from "@/lib/api/oauth/web/completeWebOAuthConnect";
import { exchangeXCode } from "@/lib/api/x/data/exchangeXCode";
import { getXProfile } from "@/lib/api/x/data/getXProfile";
import type { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/social/x/connect?code=...&state=...
 *
 * Popup callback for the X web connect flow: exchanges the code with the
 * PKCE verifier from the cookie, reads the user, and stores the account.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return completeWebOAuthConnect(request, {
    platform: "x",
    stateCookieName: "x_auth_state",
    verifierCookieName: "x_auth_verifier",
    successCallbackName: "onXConnectSuccess",
    failureCallbackName: "onXConnectFailure",
    exchangeAndFetchAccounts: async (code, codeVerifier) => {
      const exchangeResult = await exchangeXCode(code, codeVerifier ?? "");
      if (!exchangeResult.success) {
        return { success: false, message: exchangeResult.message };
      }
      const tokens = exchangeResult.data;

      const profileResult = await getXProfile(tokens.access_token);
      if (!profileResult.success) {
        return { success: false, message: profileResult.message };
      }
      const user = profileResult.data;

      const tokenExpiresAt = new Date(
        Date.now() + tokens.expires_in * 1000,
      ).toISOString();

      return {
        success: true,
        accounts: [
          {
            accountIdentifier: user.id,
            displayName: user.name,
            username: user.username,
            avatarUrl: user.avatarUrl,
            emailAddress: null,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token ?? null,
            tokenExpiresAt,
            extra: {
              scope: tokens.scope ?? null,
              is_verified: user.isVerified,
            },
          },
        ],
      };
    },
  });
}
