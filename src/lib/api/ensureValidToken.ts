import type { Platform } from "@/db/schema";
import type { PlatformFailureReason } from "@/lib/api/_shared/platformFailure";
import {
  isTokenExpiring,
  refreshWithAccountLock,
  settleRefusedRefresh,
  type LockedCredential,
  type RefreshTokenRotation,
  type RefreshWindowOptions,
} from "@/lib/api/refreshWithAccountLock";
import type { TokenRefreshResult } from "@/lib/api/requestTokenRefresh";
import type { RegistryPlatformId } from "@/lib/platforms/providers/catalog";
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

type LegacyPlatform = Exclude<Platform, RegistryPlatformId>;

type LegacyTokenRefresher = {
  refreshTokenRotation: RefreshTokenRotation;
  refreshStoredToken: (account: SocialAccount) => Promise<TokenRefreshResult>;
};

function refreshFromStoredRefreshToken(
  refreshToken: (storedRefreshToken: string) => Promise<TokenRefreshResult>,
): LegacyTokenRefresher["refreshStoredToken"] {
  return async (account) =>
    account.refresh_token
      ? refreshToken(account.refresh_token)
      : { kind: "rejected", message: "No refresh token stored." };
}

const LEGACY_TOKEN_REFRESHERS = {
  x: {
    refreshTokenRotation: "rotating",
    refreshStoredToken: refreshFromStoredRefreshToken(refreshXToken),
  },
  // https://developers.tiktok.com/doc/oauth-user-access-token-management (Refresh token rotation)
  tiktok: {
    refreshTokenRotation: "rotating",
    refreshStoredToken: refreshFromStoredRefreshToken(refreshTikTokToken),
  },
  // Every refresh returns a new continuous refresh token, and RFC 6749 section 6 lets
  // the server revoke the old one: https://developers.pinterest.com/docs/getting-started/authentication-and-scopes/
  pinterest: {
    refreshTokenRotation: "rotating",
    refreshStoredToken: refreshFromStoredRefreshToken(refreshPinterestToken),
  },
  // A refresh returns the same refresh token with its lifetime unchanged:
  // https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens
  linkedin: {
    refreshTokenRotation: "stable",
    refreshStoredToken: refreshFromStoredRefreshToken(refreshLinkedInToken),
  },
  // Google issues the refresh token once and it stays valid until revoked:
  // https://developers.google.com/identity/protocols/oauth2/web-server (Refreshing an access token)
  youtube: {
    refreshTokenRotation: "stable",
    refreshStoredToken: refreshFromStoredRefreshToken(refreshYouTubeToken),
  },
  instagram: {
    refreshTokenRotation: "stable",
    refreshStoredToken: async (account) =>
      account.access_token
        ? refreshInstagramToken(account.access_token)
        : { kind: "rejected", message: "No access token stored." },
  },
  facebook: {
    refreshTokenRotation: "stable",
    refreshStoredToken: async () => ({
      kind: "rejected",
      message: "Facebook Page token expired or was revoked.",
    }),
  },
} satisfies Record<LegacyPlatform, LegacyTokenRefresher>;

function isLegacyPlatform(platform: Platform): platform is LegacyPlatform {
  return Object.hasOwn(LEGACY_TOKEN_REFRESHERS, platform);
}

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

  if (!isLegacyPlatform(account.platform)) {
    console.error(`[ensureValidToken] No token refresh for ${account.platform}`);
    return buildRetryLaterResult(account.platform);
  }
  const refresher = LEGACY_TOKEN_REFRESHERS[account.platform];

  console.log(
    `[ensureValidToken ${account.platform}] Token expired or close to expiry, refreshing...`,
  );

  const outcome = await refreshWithAccountLock({
    accountId: account.id,
    refreshTokenRotation: refresher.refreshTokenRotation,
    refreshIfExpiringWithinMs: options.refreshIfExpiringWithinMs,
    refreshStoredCredential: ({ stored, storeCredential }) =>
      refreshAndStoreToken({ ...account, ...stored }, refresher, storeCredential),
  });
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
  refresher: LegacyTokenRefresher,
  storeCredential: LockedCredential["storeCredential"],
): Promise<EnsureValidTokenResult> {
  try {
    const refreshResult = await refresher.refreshStoredToken(account);
    if (refreshResult.kind === "failed") {
      return buildRetryLaterResult(account.platform);
    }
    if (refreshResult.kind === "rejected") {
      return handleRejectedRefresh(account);
    }
    const newTokens = refreshResult.tokens;

    const storeOutcome = await storeCredential({
      access_token: newTokens.access_token,
      refresh_token: newTokens.refresh_token || account.refresh_token,
      token_expires_at: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
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
