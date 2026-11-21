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
  settleRefusedRefresh,
  type RefreshWindowOptions,
  type StoredCredential,
} from "@/lib/api/refreshWithAccountLock";
import { RegistryPublishOptionsSchema } from "@/lib/platforms/postTargetOptions";
import type { SocialAccount } from "@/lib/types/dbTypes";

import { readAccountConfig } from "./_shared/accountConfig";
import { refusePublish } from "./_shared/publishFailure";
import { isSignedStorageUrl } from "./_shared/signedStorageUrl";
import { resolveConfiguredProvider } from "./registry";
import type {
  ProviderConfig,
  ProviderDefinition,
  TokenRefreshFailureReason,
} from "./types";

const ROTATED_TOKEN_WRITE_ATTEMPTS = 2;

export type RegistryPublishOutcome =
  | { success: true; count: 1; reconnectWarning: string | null }
  | { success: false; count: 0; message: string; failure: PlatformFailure };

export type PostOrigin =
  | { kind: "scheduled"; scheduledPostId: string }
  | { kind: "post_now"; dispatchId: string };

export type RegistryPublishArgs = {
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
  postType: MediaType;
  origin: PostOrigin;
};

type ResolvedPostOrigin = {
  scheduledPostId: string | null;
  idempotencyKey: string;
};

function resolvePostOrigin(origin: PostOrigin): ResolvedPostOrigin {
  switch (origin.kind) {
    case "scheduled":
      return { scheduledPostId: origin.scheduledPostId, idempotencyKey: origin.scheduledPostId };
    case "post_now":
      return { scheduledPostId: null, idempotencyKey: origin.dispatchId };
    default: {
      const unhandledOrigin: never = origin;
      return unhandledOrigin;
    }
  }
}

export async function publishViaRegistry(
  args: RegistryPublishArgs,
): Promise<RegistryPublishOutcome> {
  const { account } = args;
  const logPrefix = `[publishViaRegistry ${account.platform}]`;
  const postOrigin = resolvePostOrigin(args.origin);

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

  const { mediaUrl } = args;
  if (mediaUrl !== null && !isSignedStorageUrl(mediaUrl, process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) {
    return toRefusedOutcome("The post media URL is not a signed URL from our storage.");
  }
  const parsedOptions = RegistryPublishOptionsSchema.safeParse(args.options ?? {});
  if (!parsedOptions.success) {
    const invalidKeys = parsedOptions.error.issues.map((issue) => issue.path.join("."));
    return toRefusedOutcome(`Malformed post_options: ${invalidKeys.join(", ")}`);
  }

  const tokenResult = await ensureFreshRegistryToken(provider, account);
  if (!tokenResult.success) {
    return {
      success: false,
      count: 0,
      message: tokenResult.message,
      failure: { reason: tokenResult.reason, mayHavePublished: false },
    };
  }

  const config = readAccountConfig(account.extra);

  const publishResult = await provider.publish({
    accessToken: tokenResult.accessToken,
    config,
    accountIdentifier: account.account_identifier,
    title: args.title ?? "",
    body: args.body ?? "",
    postType: args.postType,
    mediaUrl,
    fileName: args.fileName,
    mediaMimeType: args.mediaMimeType,
    options: parsedOptions.data,
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
      media_type: args.postType,
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

type RegistryTokenFailure = { success: false; message: string; reason: TokenRefreshFailureReason };

export type FreshTokenResult =
  | { success: true; accessToken: string; reconnectWarning: string | null }
  | RegistryTokenFailure;

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
    return settleRegistryRefusal({
      accountId: account.id,
      platform: account.platform,
      refusedExpiresAt: account.token_expires_at,
      refusal: buildSessionExpiredResult(provider.label),
    });
  }

  const config = readAccountConfig(account.extra);
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
  config: ProviderConfig;
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
    const refusal: RegistryTokenFailure = {
      success: false,
      message: `Unable to refresh your ${providerLabel} connection: ${refreshed.message}`,
      reason: refreshed.reason,
    };
    if (refreshed.reason === "transient") return refusal;
    return settleRegistryRefusal({
      accountId: input.accountId,
      platform: input.platform,
      refusedExpiresAt: stored.token_expires_at,
      refusal,
    });
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
          is_available: true,
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

async function settleRegistryRefusal(input: {
  accountId: string;
  platform: string;
  refusedExpiresAt: string | null;
  refusal: RegistryTokenFailure;
}): Promise<FreshTokenResult> {
  const settled = await settleRefusedRefresh(input);
  return settled.kind === "refreshed_elsewhere"
    ? { success: true, accessToken: settled.accessToken, reconnectWarning: null }
    : input.refusal;
}

function buildSessionExpiredResult(providerLabel: string): RegistryTokenFailure {
  return {
    success: false,
    message: `Your ${providerLabel} session has expired and cannot be renewed automatically. Please reconnect the account.`,
    reason: "auth_expired",
  };
}

function toRefusedOutcome(message: string): RegistryPublishOutcome {
  const { failure } = refusePublish(message);
  return { success: false, count: 0, message, failure };
}
