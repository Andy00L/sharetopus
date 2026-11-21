import type { Platform } from "@/db/schema";
import type { PlatformFailureReason } from "@/lib/api/_shared/platformFailure";
import {
  isTokenExpiring,
  refreshWithAccountLock,
  settleRefusedRefresh,
  storeRefreshedCredential,
  type RefreshWindowOptions,
} from "@/lib/api/refreshWithAccountLock";
import type { TokenRefreshResult } from "@/lib/api/requestTokenRefresh";
import type { SocialAccount } from "@/lib/types/dbTypes";
import refreshInstagramToken from "./instagram/data/refreshInstagramToken";
import refreshLinkedInToken from "./linkedin/data/refreshLinkedinToken";
import refreshPinterestToken from "./pinterest/data/refreshPinterestToken";
import refreshTikTokToken from "./tiktok/data/refreshTikTokToken";
import refreshXToken from "./x/data/refreshXToken";
import refreshYouTubeToken from "./youtube/data/refreshYouTubeToken";

type TokenFailureReason = Extract<PlatformFailureReason, "auth_expired" | "transient">;

type EnsureValidTokenResult =
  | { success: true; token: string; error?: undefined }
  | {
      success: false;
      token?: undefined;
      error: string;
      failureReason: TokenFailureReason;
    };

function buildReconnectResult(platform: Platform): EnsureValidTokenResult {
  return {
    success: false,
    error: `Your ${platform} account needs to be reconnected. Please go to your connections page to reconnect.`,
    failureReason: "auth_expired",
  };
}

export async function ensureValidToken(
  account: SocialAccount,
  options: RefreshWindowOptions = {},
): Promise<EnsureValidTokenResult> {
  const accessToken = account.access_token;
  if (!accessToken) {
    console.error(
      `[ensureValidToken] No access token for ${account.platform}`,
    );
    return buildReconnectResult(account.platform);
  }

  if (!isTokenExpiring(account.token_expires_at, options.refreshIfExpiringWithinMs)) {
    return {
      success: true,
      token: accessToken,
    };
  }

  console.log(
    `[ensureValidToken ${account.platform}] Token expired or close to expiry, refreshing...`,
  );

  const outcome = await refreshWithAccountLock(
    account.id,
    (stored) => refreshAndStoreToken({ ...account, ...stored }),
    options,
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

    const storeOutcome = await storeRefreshedCredential({
      accountId: account.id,
      replacedExpiresAt: account.token_expires_at,
      credential: {
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token || account.refresh_token,
        token_expires_at: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
      },
    });

    switch (storeOutcome.kind) {
      case "stored":
        console.log(
          `[ensureValidToken ${account.platform}] Token refreshed successfully`,
        );
        return { success: true, token: newTokens.access_token };
      case "superseded":
        return { success: true, token: storeOutcome.accessToken };
      case "failed":
        logLostTokenStore(account, newTokens.refresh_token, storeOutcome.message);
        return { success: true, token: newTokens.access_token };
    }
  } catch (error) {
    console.error(
      `[ensureValidToken ${account.platform}] Refresh error:`,
      error,
    );
    return {
      success: false,
      error: `There was a problem refreshing your ${account.platform} connection. Please try again or reconnect your account.`,
      failureReason: "transient",
    };
  }
}

function buildRetryLaterResult(platform: Platform): EnsureValidTokenResult {
  return {
    success: false,
    error: `We could not refresh your ${platform} connection just now. Please try again in a few minutes.`,
    failureReason: "transient",
  };
}

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
      return account.access_token
        ? refreshInstagramToken(account.access_token)
        : { kind: "rejected", message: "No access token stored." };
    case "facebook":
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

async function handleRejectedRefresh(
  account: SocialAccount,
): Promise<EnsureValidTokenResult> {
  const settled = await settleRefusedRefresh({
    accountId: account.id,
    platform: account.platform,
    refusedExpiresAt: account.token_expires_at,
  });
  switch (settled.kind) {
    case "refreshed_elsewhere":
      return { success: true, token: settled.accessToken };
    case "needs_reconnect":
      return buildReconnectResult(account.platform);
    case "retry_later":
      return buildRetryLaterResult(account.platform);
  }
}

function logLostTokenStore(
  account: SocialAccount,
  newRefreshToken: string | undefined,
  storeErrorMessage: string,
): void {
  const refreshTokenWasRotated =
    Boolean(newRefreshToken) && newRefreshToken !== account.refresh_token;

  if (refreshTokenWasRotated) {
    console.error(
      `[logLostTokenStore ${account.platform}] RECONNECT REQUIRED: ` +
        `refresh token rotated but could not be persisted for account ` +
        `${account.id}. The stored refresh token is now invalid and its ` +
        `replacement was lost; automatic refresh will fail from here on. ${storeErrorMessage}`,
    );
    return;
  }
  console.error(
    `[logLostTokenStore ${account.platform}] DB update failed after ` +
      `refresh for account ${account.id}; the stored refresh token is ` +
      `still valid, so the next call will refresh again. ${storeErrorMessage}`,
  );
}
