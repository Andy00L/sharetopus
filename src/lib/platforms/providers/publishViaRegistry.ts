import "server-only";

import { eq } from "drizzle-orm";

import { storeContentHistory } from "@/actions/server/contentHistoryActions/storeContentHistory";
import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import type { CreatedVia, MediaType } from "@/db/schema";
import type { PlatformFailure } from "@/lib/api/_shared/platformFailure";
import {
  isTokenExpiring,
  refreshWithAccountLock,
  type RefreshWindowOptions,
  type StoredCredential,
} from "@/lib/api/refreshWithAccountLock";
import type { SocialAccount } from "@/lib/types/dbTypes";
import { toJsonObject, type JsonObject } from "@/lib/utils/jsonObject";

import { resolveConfiguredProvider } from "./registry";
import type { ProviderDefinition, TokenRefreshFailureReason } from "./types";

const ROTATED_TOKEN_WRITE_ATTEMPTS = 2;

export type RegistryPublishOutcome =
  | { success: true; count: 1; reconnectWarning: string | null }
  | { success: false; count: 0; message: string; failure: PlatformFailure };

export type RegistryPublishResult = {
  success: boolean;
  count: number;
  message?: string;
  failure?: PlatformFailure;
};

export type RegistryPostOrigin =
  | { kind: "scheduled"; scheduledPostId: string }
  | { kind: "post_now"; dispatchId: string };

type RegistryPublishContent = {
  account: SocialAccount;
  principalId: string;
  title: string | null;
  body: string | null;
  mediaUrl: string | null;
  fileName: string;
  mediaMimeType: string;
  options: unknown;
  batchId: string;
  createdVia: CreatedVia;
};

export type RegistryPublishArgs = RegistryPublishContent &
  (
    | { postType: MediaType; origin: RegistryPostOrigin }
    | { mediaType: MediaType; scheduledPostId: string | null }
  );

type ResolvedPostOrigin = {
  postType: MediaType;
  scheduledPostId: string | null;
  idempotencyKey: string | null;
};

function resolvePostOrigin(args: RegistryPublishArgs): ResolvedPostOrigin {
  if (!("origin" in args)) {
    return {
      postType: args.mediaType,
      scheduledPostId: args.scheduledPostId,
      idempotencyKey: args.scheduledPostId,
    };
  }
  switch (args.origin.kind) {
    case "scheduled":
      return {
        postType: args.postType,
        scheduledPostId: args.origin.scheduledPostId,
        idempotencyKey: args.origin.scheduledPostId,
      };
    case "post_now":
      return {
        postType: args.postType,
        scheduledPostId: null,
        idempotencyKey: args.origin.dispatchId,
      };
    default: {
      const unhandledOrigin: never = args.origin;
      return unhandledOrigin;
    }
  }
}

export async function publishViaRegistry(
  args: RegistryPublishArgs,
): Promise<RegistryPublishOutcome> {
  const { account } = args;
  const logPrefix = `[publishViaRegistry ${account.platform}]`;
  const postOrigin = resolvePostOrigin(args);

  const providerResult = resolveConfiguredProvider(account.platform);
  if (!providerResult.ok) {
    return {
      success: false,
      count: 0,
      message: `${account.platform} is not available: ${providerResult.message}`,
      failure: { reason: "unknown", mayHavePublished: false },
    };
  }
  const provider = providerResult.provider;

  const tokenResult = await ensureFreshRegistryToken(provider, account);
  if (!tokenResult.success) {
    return {
      success: false,
      count: 0,
      message: tokenResult.message,
      failure: { reason: tokenResult.reason, mayHavePublished: false },
    };
  }

  const config = narrowAccountConfig(account.extra);

  const publishResult = await provider.publish({
    accessToken: tokenResult.accessToken,
    config,
    accountIdentifier: account.account_identifier,
    title: args.title ?? "",
    body: args.body ?? "",
    postType: postOrigin.postType,
    mediaUrl: args.mediaUrl,
    fileName: args.fileName,
    mediaMimeType: args.mediaMimeType,
    options: narrowAccountConfig(args.options),
    idempotencyKey: postOrigin.idempotencyKey,
  });

  if (!publishResult.ok) {
    return {
      success: false,
      count: 0,
      message: publishResult.message,
      failure: publishResult.failure,
    };
  }

  const historyResult = await storeContentHistory(
    {
      platform: account.platform,
      content_id: publishResult.postId,
      social_account_id: account.id,
      title: args.title,
      description: args.body,
      media_url: publishResult.postUrl ?? args.mediaUrl,
      batch_id: args.batchId,
      scheduled_post_id: postOrigin.scheduledPostId,
      status: "posted",
      media_type: postOrigin.postType,
      extra: {
        post_url: publishResult.postUrl,
        published_via: "provider_registry",
        posted_at: new Date().toISOString(),
      },
      created_via: args.createdVia,
    },
    args.principalId,
  );

  if (!historyResult.success) {
    console.error(
      `${logPrefix} CONTENT HISTORY NOT RECORDED for a published post ` +
        `(account=${account.id} scheduled_post_id=${postOrigin.scheduledPostId ?? "post-now"} ` +
        `content_id=${publishResult.postId}): ${historyResult.message}`,
    );
  }

  return { success: true, count: 1, reconnectWarning: tokenResult.reconnectWarning };
}

export type FreshTokenResult =
  | { success: true; accessToken: string; reconnectWarning: string | null }
  | { success: false; message: string; reason: TokenRefreshFailureReason };

export async function refreshRegistryAccountToken(
  account: SocialAccount,
  options: RefreshWindowOptions = {},
): Promise<FreshTokenResult> {
  const providerResult = resolveConfiguredProvider(account.platform);
  if (!providerResult.ok) {
    return { success: false, message: providerResult.message, reason: "transient" };
  }
  return ensureFreshRegistryToken(providerResult.provider, account, options);
}

async function ensureFreshRegistryToken(
  provider: ProviderDefinition,
  account: SocialAccount,
  options: RefreshWindowOptions = {},
): Promise<FreshTokenResult> {
  if (!account.access_token) {
    return {
      success: false,
      message: `Your ${provider.label} account needs to be reconnected.`,
      reason: "auth_expired",
    };
  }

  if (!isTokenExpiring(account.token_expires_at, options.refreshIfExpiringWithinMs)) {
    return { success: true, accessToken: account.access_token, reconnectWarning: null };
  }

  const refreshCredential = provider.refresh;
  if (!refreshCredential) {
    return buildSessionExpiredResult(provider.label);
  }

  const config = narrowAccountConfig(account.extra);
  const outcome = await refreshWithAccountLock(
    account.id,
    (stored) =>
      refreshAndStoreRegistryToken({
        providerLabel: provider.label,
        refreshCredential,
        accountId: account.id,
        platform: account.platform,
        config,
        stored,
      }),
    options,
  );
  switch (outcome.kind) {
    case "stored_token_fresh":
      return { success: true, accessToken: outcome.accessToken, reconnectWarning: null };
    case "refreshed":
      return outcome.value;
    case "unavailable":
      return {
        success: false,
        message: `We could not refresh your ${provider.label} connection just now. Please try again in a few minutes.`,
        reason: "transient",
      };
  }
}

async function refreshAndStoreRegistryToken(input: {
  providerLabel: string;
  refreshCredential: NonNullable<ProviderDefinition["refresh"]>;
  accountId: string;
  platform: string;
  config: JsonObject;
  stored: StoredCredential;
}): Promise<FreshTokenResult> {
  const { providerLabel, stored } = input;
  const logPrefix = `[refreshAndStoreRegistryToken ${input.platform}]`;

  const refreshed = await input.refreshCredential({
    accessToken: stored.access_token,
    refreshToken: stored.refresh_token,
    config: input.config,
  });
  if (!refreshed.ok) {
    return {
      success: false,
      message: `Unable to refresh your ${providerLabel} connection: ${refreshed.message}`,
      reason: refreshed.reason,
    };
  }

  const hasRotatedRefreshToken =
    refreshed.rotatedRefreshToken !== null &&
    refreshed.rotatedRefreshToken !== stored.refresh_token;
  const writeAttempts = hasRotatedRefreshToken ? ROTATED_TOKEN_WRITE_ATTEMPTS : 1;
  let persistErrorMessage: string | null = null;
  for (let attemptIndex = 0; attemptIndex < writeAttempts; attemptIndex++) {
    const { error: persistError } = await runQuery(
      db
        .update(social_accounts)
        .set({
          access_token: refreshed.accessToken,
          refresh_token: refreshed.rotatedRefreshToken ?? stored.refresh_token,
          token_expires_at:
            refreshed.expiresIn === null
              ? null
              : new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .where(eq(social_accounts.id, input.accountId)),
    );
    persistErrorMessage = persistError?.message ?? null;
    if (!persistError) break;
  }

  if (persistErrorMessage === null) {
    return { success: true, accessToken: refreshed.accessToken, reconnectWarning: null };
  }
  if (!hasRotatedRefreshToken) {
    console.error(
      `${logPrefix} Token persist failed for account ${input.accountId}; the ` +
        `stored refresh token is still valid. ${persistErrorMessage}`,
    );
    return { success: true, accessToken: refreshed.accessToken, reconnectWarning: null };
  }
  console.error(
    `${logPrefix} RECONNECT REQUIRED: the rotated refresh token for account ` +
      `${input.accountId} could not be saved. ${persistErrorMessage}`,
  );
  return {
    success: true,
    accessToken: refreshed.accessToken,
    reconnectWarning: `${providerLabel} renewed this connection but the renewed credential could not be saved, so it will stop working when the current token expires. Please reconnect the account.`,
  };
}

function buildSessionExpiredResult(providerLabel: string): FreshTokenResult {
  return {
    success: false,
    message: `Your ${providerLabel} session has expired and cannot be renewed automatically. Please reconnect the account.`,
    reason: "auth_expired",
  };
}

function narrowAccountConfig(rawValue: unknown): JsonObject {
  return toJsonObject(rawValue) ?? {};
}
