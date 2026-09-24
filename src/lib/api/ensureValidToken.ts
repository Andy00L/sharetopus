// lib/api/ensureValidToken.ts
import { and, eq } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import type { Platform } from "@/db/schema";
import {
  isTokenExpiring,
  readStoredCredential,
  refreshWithAccountLock,
  selectFreshAccessToken,
} from "@/lib/api/refreshWithAccountLock";
import type { TokenRefreshResult } from "@/lib/api/requestTokenRefresh";
import { SocialAccount, TokenExchangeResponse } from "@/lib/types/dbTypes";
import refreshInstagramToken from "./instagram/data/refreshInstagramToken";
import refreshLinkedInToken from "./linkedin/data/refreshLinkedinToken";
import refreshPinterestToken from "./pinterest/data/refreshPinterestToken";
import refreshTikTokToken from "./tiktok/data/refreshTikTokToken";
import refreshXToken from "./x/data/refreshXToken";
import refreshYouTubeToken from "./youtube/data/refreshYouTubeToken";

type EnsureValidTokenResult = {
  success: boolean;
  token?: string;
  error?: string;
};

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
 *
 * The refresh runs under refreshWithAccountLock: when several runs find the
 * same expired token, one refreshes and the others reuse the token it saved.
 *
 * When the platform refuses the stored credential, the account is flagged
 * is_available = false so the x402 and MCP connection lists report it as
 * needing re-authentication. A refresh that fails for a reason that may
 * pass (network, 5xx, missing config) leaves the account untouched, and a
 * successful refresh clears the flag.
 */
export async function ensureValidToken(
  account: SocialAccount,
): Promise<EnsureValidTokenResult> {
  const accessToken = account.access_token;
  if (!accessToken) {
    console.error(
      `[ensureValidToken] No access token for ${account.platform}`,
    );
    return {
      success: false,
      error: `Your ${account.platform} account needs to be reconnected. Please go to your connections page to reconnect.`,
    };
  }

  if (!isTokenExpiring(account.token_expires_at)) {
    return {
      success: true,
      token: accessToken,
    };
  }

  console.log(
    `[ensureValidToken ${account.platform}] Token expired or close to expiry, refreshing...`,
  );

  // Refreshes from the stored credential, not this copy: the refresh token
  // may have rotated since this copy was read.
  const outcome = await refreshWithAccountLock(account.id, (stored) =>
    refreshAndStoreToken({ ...account, ...stored }),
  );
  switch (outcome.kind) {
    case "stored_token_fresh":
      return { success: true, token: outcome.accessToken };
    case "refreshed":
      return outcome.value;
    case "unavailable":
      return buildRetryLaterResult(account.platform);
  }
}

/**
 * Refreshes the account's token and saves the new pair. Runs under the
 * account's refresh lock; `account` carries the credential just read from
 * the row.
 */
async function refreshAndStoreToken(
  account: SocialAccount,
): Promise<EnsureValidTokenResult> {
  try {
    const refreshResult = await refreshTokenForPlatform(account);
    if (refreshResult.kind === "failed") {
      return buildRetryLaterResult(account.platform);
    }
    if (refreshResult.kind === "rejected") {
      return handleRejectedRefresh(account);
    }
    const newTokens = refreshResult.tokens;

    const updateSuccess = await updateTokenInDatabase(
      account.id,
      account.platform,
      newTokens,
      account.refresh_token ?? null,
    );

    if (!updateSuccess) {
      // The refreshed access token still works for THIS call, so the
      // caller proceeds. What the caller cannot see is whether the
      // account was just left unrecoverable.
      //
      // Platforms that rotate the refresh token (X returns a fresh one
      // and invalidates the old one on every refresh) consumed the stored
      // credential to produce these tokens. If the new pair was not
      // persisted, the stored refresh token is now dead and its
      // replacement is gone: every later refresh fails and the user must
      // reconnect by hand. That warrants a distinct, greppable line
      // rather than the generic message this branch used to log.
      const refreshTokenWasRotated =
        Boolean(newTokens.refresh_token) &&
        newTokens.refresh_token !== account.refresh_token;

      if (refreshTokenWasRotated) {
        console.error(
          `[ensureValidToken ${account.platform}] RECONNECT REQUIRED: ` +
            `refresh token rotated but could not be persisted for account ` +
            `${account.id}. The stored refresh token is now invalid and its ` +
            `replacement was lost; automatic refresh will fail from here on.`,
        );
      } else {
        console.error(
          `[ensureValidToken ${account.platform}] DB update failed after ` +
            `refresh for account ${account.id}; the stored refresh token is ` +
            `still valid, so the next call will refresh again.`,
        );
      }

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

/** A refresh that may pass on a later attempt; the account is left as it is. */
function buildRetryLaterResult(platform: Platform): EnsureValidTokenResult {
  return {
    success: false,
    error: `We could not refresh your ${platform} connection just now. Please try again in a few minutes.`,
  };
}

/**
 * Platform dispatch for the refresh call. Encapsulates which credential
 * each platform refreshes with (refresh_token vs long-lived access token)
 * and which platforms cannot refresh at all.
 */
async function refreshTokenForPlatform(
  account: SocialAccount,
): Promise<TokenRefreshResult> {
  const missingRefreshToken: TokenRefreshResult = {
    kind: "rejected",
    message: "No refresh token stored.",
  };

  switch (account.platform) {
    case "tiktok":
      return account.refresh_token
        ? refreshTikTokToken(account.refresh_token)
        : missingRefreshToken;
    case "pinterest":
      return account.refresh_token
        ? refreshPinterestToken(account.refresh_token)
        : missingRefreshToken;
    case "linkedin":
      return account.refresh_token
        ? refreshLinkedInToken(account.refresh_token)
        : missingRefreshToken;
    case "youtube":
      return account.refresh_token
        ? refreshYouTubeToken(account.refresh_token)
        : missingRefreshToken;
    case "x":
      return account.refresh_token
        ? refreshXToken(account.refresh_token)
        : missingRefreshToken;
    case "instagram":
      // Instagram Login refreshes the long-lived access token itself.
      return account.access_token
        ? refreshInstagramToken(account.access_token)
        : { kind: "rejected", message: "No access token stored." };
    case "facebook":
      // Facebook Page tokens do not expire; reaching this branch means the
      // token was revoked on the platform side.
      return { kind: "rejected", message: "Facebook Page token expired or was revoked." };
    default:
      console.error(
        `[refreshTokenForPlatform] Unsupported platform: ${account.platform}`,
      );
      return {
        kind: "failed",
        message: `No token refresh for ${account.platform}.`,
      };
  }
}

/**
 * The platform refused the stored credential. The refresh lock keeps other
 * runs from refreshing this account meanwhile, but it is skipped when Redis
 * is unreachable, so the row is re-read first: if it now holds an unexpired
 * token another run saved, that token is used. Otherwise the account is
 * flagged is_available = false and the caller is told to reconnect.
 */
async function handleRejectedRefresh(
  account: SocialAccount,
): Promise<EnsureValidTokenResult> {
  const stored = await readStoredCredential(account.id);
  const freshToken = stored.ok ? selectFreshAccessToken(stored.credential) : null;
  if (freshToken) {
    return { success: true, token: freshToken };
  }

  // Guarded on the token this refresh started from, so a refresh that lands
  // after the re-read is never overwritten with a stale flag. A row with no
  // token has nothing to guard on and is left as it is.
  const staleAccessToken = account.access_token;
  if (staleAccessToken) {
    const { error: flagError } = await runQuery(
      db
        .update(social_accounts)
        .set({ is_available: false, updated_at: new Date().toISOString() })
        .where(
          and(
            eq(social_accounts.id, account.id),
            eq(social_accounts.access_token, staleAccessToken),
          ),
        ),
    );

    if (flagError) {
      console.error(
        `[handleRejectedRefresh ${account.platform}] Could not flag account ${account.id} as unavailable: ${flagError.message}`,
      );
    } else {
      console.warn(
        `[handleRejectedRefresh ${account.platform}] Account ${account.id} flagged as needing re-authentication.`,
      );
    }
  }

  return {
    success: false,
    error: `Your ${account.platform} account needs to be reconnected. Please go to your connections page to reconnect.`,
  };
}

/**
 * Persists refreshed tokens for a social account.
 *
 * `currentRefreshToken` is the token already stored for this account. When
 * a refresh response omits a new refresh token (or returns an empty one),
 * the existing token is kept rather than nulled: only X rotates the refresh
 * token on every call, and losing a still-valid token would break future
 * auto-refresh and force a manual reconnect.
 */
async function updateTokenInDatabase(
  accountId: string,
  platform: Platform,
  tokenData: TokenExchangeResponse,
  currentRefreshToken: string | null,
): Promise<boolean> {
  try {
    console.log(
      `[updateTokenInDatabase ${platform}] Updating tokens for account ${accountId}`,
    );

    const now = new Date();
    const expiresAt = new Date(now.getTime() + tokenData.expires_in * 1000);

    const updatePayload = {
      access_token: tokenData.access_token,
      // Keep the existing refresh token when the response omits or blanks
      // it; X rotates it and returns a fresh one, which takes precedence.
      refresh_token: tokenData.refresh_token || currentRefreshToken,
      token_expires_at: expiresAt.toISOString(),
      // A refresh that worked proves the account is usable again, clearing
      // any earlier "needs re-authentication" flag.
      is_available: true,
      updated_at: new Date().toISOString(),
    };

    const runUpdate = async (): Promise<string | null> => {
      const { error } = await runQuery(
        db
          .update(social_accounts)
          .set(updatePayload)
          .where(
            and(
              eq(social_accounts.id, accountId),
              eq(social_accounts.platform, platform),
            ),
          ),
      );
      return error ? error.message : null;
    };

    // One immediate retry. On platforms that rotate the refresh token, the
    // credential that produced these tokens is already spent, so losing
    // this write costs the user a manual reconnect. A transient database
    // error is worth a second attempt before accepting that.
    let updateError = await runUpdate();
    if (updateError) {
      console.warn(
        `[updateTokenInDatabase ${platform}] Update failed for account ` +
          `${accountId}, retrying once: ${updateError}`,
      );
      updateError = await runUpdate();
    }

    if (updateError) {
      console.error(
        `[updateTokenInDatabase ${platform}] Update error after retry for ` +
          `account ${accountId}: ${updateError}`,
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
