// lib/api/auth/ensureValidToken.ts
import { adminSupabase } from "@/actions/api/adminSupabase";
import type { Platform } from "@/lib/types/database.types";
import { SocialAccount, TokenExchangeResponse } from "@/lib/types/dbTypes";
import refreshInstagramToken from "./instagram/data/refreshInstagramToken";
import refreshLinkedInToken from "./linkedin/data/refreshLinkedinToken";
import refreshPinterestToken from "./pinterest/data/refreshPinterestToken";
import refreshTikTokToken from "./tiktok/data/refreshTikTokToken";
import refreshXToken from "./x/data/refreshXToken";
import refreshYouTubeToken from "./youtube/data/refreshYouTubeToken";

/**
 * Returns a valid access token for any platform, refreshing it first when
 * it is expired or about to expire.
 *
 * Refresh strategy per platform:
 *   - tiktok / pinterest / linkedin / youtube / x: standard refresh_token
 *     grant (x additionally ROTATES the refresh token on every call).
 *   - instagram: no refresh_token exists; the long-lived ACCESS token is
 *     exchanged for a fresh one via /refresh_access_token.
 *   - facebook: Page tokens minted from a long-lived user token do not
 *     expire (token_expires_at is stored null, so this path is only reached
 *     if the token was revoked); the user must reconnect.
 */
export async function ensureValidToken(account: SocialAccount): Promise<{
  success: boolean;
  token?: string;
  error?: string;
}> {
  if (!account.access_token) {
    console.error(
      `[ensureValidToken] No access token for ${account.platform}`,
    );
    return {
      success: false,
      error: `Your ${account.platform} account needs to be reconnected. Please go to your connections page to reconnect.`,
    };
  }

  const isExpired = isTokenExpired(account.token_expires_at);

  if (!isExpired) {
    return {
      success: true,
      token: account.access_token,
    };
  }

  console.log(
    `[ensureValidToken ${account.platform}] Token expired or close to expiry, refreshing...`,
  );

  try {
    const refreshResult = await refreshTokenForPlatform(account);
    if (!refreshResult.success) {
      return { success: false, error: refreshResult.error };
    }
    const newTokens = refreshResult.tokens;

    const updateSuccess = await updateTokenInDatabase(
      account.id,
      account.platform,
      newTokens,
    );

    if (!updateSuccess) {
      console.error(
        `[ensureValidToken ${account.platform}] DB update failed after refresh`,
      );
      // The refreshed token is still valid even if persisting it failed.
      return {
        success: true,
        token: newTokens.access_token,
      };
    }

    console.log(
      `[ensureValidToken ${account.platform}] Token refreshed successfully`,
    );
    return {
      success: true,
      token: newTokens.access_token,
    };
  } catch (error) {
    console.error(
      `[ensureValidToken ${account.platform}] Refresh error:`,
      error,
    );
    return {
      success: false,
      error: `There was a problem refreshing your ${account.platform} connection. Please try again or reconnect your account.`,
    };
  }
}

/**
 * Platform dispatch for the refresh call. Encapsulates which credential
 * each platform refreshes with (refresh_token vs long-lived access token)
 * and which platforms cannot refresh at all.
 */
async function refreshTokenForPlatform(
  account: SocialAccount,
): Promise<
  | { success: true; tokens: TokenExchangeResponse }
  | { success: false; error: string }
> {
  const reconnectError = `Your ${account.platform} account has expired and cannot be automatically renewed. Please reconnect your account.`;

  let newTokens: TokenExchangeResponse | null = null;

  switch (account.platform) {
    case "tiktok":
      if (!account.refresh_token) return { success: false, error: reconnectError };
      newTokens = await refreshTikTokToken(account.refresh_token);
      break;
    case "pinterest":
      if (!account.refresh_token) return { success: false, error: reconnectError };
      newTokens = await refreshPinterestToken(account.refresh_token);
      break;
    case "linkedin":
      if (!account.refresh_token) return { success: false, error: reconnectError };
      newTokens = await refreshLinkedInToken(account.refresh_token);
      break;
    case "youtube":
      if (!account.refresh_token) return { success: false, error: reconnectError };
      newTokens = await refreshYouTubeToken(account.refresh_token);
      break;
    case "x":
      if (!account.refresh_token) return { success: false, error: reconnectError };
      newTokens = await refreshXToken(account.refresh_token);
      break;
    case "instagram":
      // Instagram Login refreshes the long-lived access token itself; the
      // access_token null-check already ran in ensureValidToken.
      newTokens = await refreshInstagramToken(account.access_token ?? "");
      break;
    case "facebook":
      // Facebook Page tokens do not expire; reaching this branch means the
      // token was revoked on the platform side.
      return { success: false, error: reconnectError };
    default:
      console.error(
        `[ensureValidToken] Unsupported platform: ${account.platform}`,
      );
      return {
        success: false,
        error: `There was a problem refreshing your ${account.platform} connection. Please try again or reconnect your account.`,
      };
  }

  if (!newTokens) {
    console.error(`[ensureValidToken ${account.platform}] Refresh failed`);
    return {
      success: false,
      error: `Unable to refresh your ${account.platform} connection. Please try reconnecting your account.`,
    };
  }

  return { success: true, tokens: newTokens };
}

/**
 * Whether a token is expired or expires within the next 5 minutes.
 * A null expiry means the token never expires (Facebook Page tokens).
 */
function isTokenExpired(expiresAt: string | null): boolean {
  if (!expiresAt) {
    console.log(
      "[isTokenExpired] No expiry date found - treating as non-expiring",
    );
    return false;
  }
  try {
    const now = new Date();
    const expiry = new Date(expiresAt);

    // 5 minute buffer in milliseconds, to avoid using a token that dies
    // mid-upload.
    const bufferTime = 5 * 60 * 1000;
    const isExpired = now.getTime() + bufferTime >= expiry.getTime();
    console.log(
      `[isTokenExpired] Token expires at: ${expiry.toISOString()}, Current time: ${now.toISOString()}, Expired: ${isExpired}`,
    );

    return isExpired;
  } catch (error) {
    console.error("[isTokenExpired] Error parsing expiry date:", error);
    return false;
  }
}

/**
 * Persists refreshed tokens for a social account.
 */
async function updateTokenInDatabase(
  accountId: string,
  platform: Platform,
  tokenData: TokenExchangeResponse,
): Promise<boolean> {
  try {
    console.log(
      `[updateTokenInDatabase ${platform}] Updating tokens for account ${accountId}`,
    );

    const now = new Date();
    const expiresAt = new Date(now.getTime() + tokenData.expires_in * 1000);

    const { error } = await adminSupabase
      .from("social_accounts")
      .update({
        access_token: tokenData.access_token,
        // Some refreshes do not return a new refresh_token; X rotates it.
        refresh_token: tokenData.refresh_token || null,
        token_expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", accountId)
      .eq("platform", platform);

    if (error) {
      console.error(
        `[updateTokenInDatabase ${platform}] Update error:`,
        error,
      );
      return false;
    }

    console.log(
      `[updateTokenInDatabase ${platform}] Tokens updated for ${accountId}`,
    );
    return true;
  } catch (error) {
    console.error(`[updateTokenInDatabase ${platform}] Error:`, error);
    return false;
  }
}
