import "server-only";

import { eq } from "drizzle-orm";

import { storeContentHistory } from "@/actions/server/contentHistoryActions/storeContentHistory";
import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import type { CreatedVia, MediaType } from "@/db/schema";
import {
  isTokenExpiring,
  refreshWithAccountLock,
  type StoredCredential,
} from "@/lib/api/refreshWithAccountLock";
import type { SocialAccount } from "@/lib/types/dbTypes";
import { toJsonObject, type JsonObject } from "@/lib/utils/jsonObject";

import { resolveConfiguredProvider } from "./registry";
import type { ProviderDefinition } from "./types";

export type RegistryPublishResult = {
  success: boolean;
  count: number;
  message?: string;
};

export type RegistryPublishArgs = {
  account: SocialAccount;
  principalId: string;
  title: string | null;
  body: string | null;
  mediaType: MediaType;
  mediaUrl: string | null;
  fileName: string;
  mediaMimeType: string;
  options: unknown;
  batchId: string;
  scheduledPostId: string | null;
  createdVia: CreatedVia;
};

export async function publishViaRegistry(
  args: RegistryPublishArgs,
): Promise<RegistryPublishResult> {
  const { account } = args;
  const logPrefix = `[publishViaRegistry ${account.platform}]`;

  const providerResult = resolveConfiguredProvider(account.platform);
  if (!providerResult.ok) {
    return {
      success: false,
      count: 0,
      message: `${account.platform} is not available: ${providerResult.message}`,
    };
  }
  const provider = providerResult.provider;

  const tokenResult = await ensureFreshRegistryToken(provider, account);
  if (!tokenResult.success) {
    return { success: false, count: 0, message: tokenResult.message };
  }

  const config = narrowAccountConfig(account.extra);

  const publishResult = await provider.publish({
    accessToken: tokenResult.accessToken,
    config,
    accountIdentifier: account.account_identifier,
    title: args.title ?? "",
    body: args.body ?? "",
    mediaType: args.mediaType,
    mediaUrl: args.mediaUrl,
    fileName: args.fileName,
    mediaMimeType: args.mediaMimeType,
    options: narrowAccountConfig(args.options),
  });

  if (!publishResult.ok) {
    return { success: false, count: 0, message: publishResult.message };
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
      scheduled_post_id: args.scheduledPostId,
      status: "posted",
      media_type: args.mediaType,
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
        `(account=${account.id} scheduled_post_id=${args.scheduledPostId ?? "direct"} ` +
        `content_id=${publishResult.postId}): ${historyResult.message}`,
    );
  }

  return { success: true, count: 1 };
}

type FreshTokenResult =
  | { success: true; accessToken: string }
  | { success: false; message: string };

async function ensureFreshRegistryToken(
  provider: ProviderDefinition,
  account: SocialAccount,
): Promise<FreshTokenResult> {
  if (!account.access_token) {
    return {
      success: false,
      message: `Your ${provider.label} account needs to be reconnected.`,
    };
  }

  if (!isTokenExpiring(account.token_expires_at)) {
    return { success: true, accessToken: account.access_token };
  }

  const refreshCredential = provider.refresh;
  if (!refreshCredential || !account.refresh_token) {
    return buildSessionExpiredResult(provider.label);
  }

  const outcome = await refreshWithAccountLock(account.id, (stored) =>
    refreshAndStoreRegistryToken(provider.label, refreshCredential, account, stored),
  );
  switch (outcome.kind) {
    case "stored_token_fresh":
      return { success: true, accessToken: outcome.accessToken };
    case "refreshed":
      return outcome.value;
    case "unavailable":
      return {
        success: false,
        message: `We could not refresh your ${provider.label} connection just now. Please try again in a few minutes.`,
      };
  }
}

async function refreshAndStoreRegistryToken(
  providerLabel: string,
  refreshCredential: NonNullable<ProviderDefinition["refresh"]>,
  account: SocialAccount,
  stored: StoredCredential,
): Promise<FreshTokenResult> {
  const logPrefix = `[refreshAndStoreRegistryToken ${account.platform}]`;

  if (!stored.refresh_token) {
    return buildSessionExpiredResult(providerLabel);
  }

  const refreshed = await refreshCredential(stored.refresh_token);
  if (!refreshed.ok) {
    return {
      success: false,
      message: `Unable to refresh your ${providerLabel} connection: ${refreshed.message}`,
    };
  }

  const nextRefreshToken = refreshed.refreshToken ?? stored.refresh_token;
  const nextExpiresAt =
    refreshed.expiresIn === null
      ? null
      : new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();

  const { error: persistError } = await runQuery(
    db
      .update(social_accounts)
      .set({
        access_token: refreshed.accessToken,
        refresh_token: nextRefreshToken,
        token_expires_at: nextExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .where(eq(social_accounts.id, account.id)),
  );

  if (persistError) {
    const rotated =
      Boolean(refreshed.refreshToken) &&
      refreshed.refreshToken !== stored.refresh_token;
    if (rotated) {
      console.error(
        `${logPrefix} RECONNECT REQUIRED: refresh token rotated but could ` +
          `not be persisted for account ${account.id}; automatic refresh ` +
          `will fail from here on. ${persistError.message}`,
      );
    } else {
      console.error(
        `${logPrefix} Token persist failed for account ${account.id}; the ` +
          `stored refresh token is still valid. ${persistError.message}`,
      );
    }
  }

  return { success: true, accessToken: refreshed.accessToken };
}

function buildSessionExpiredResult(providerLabel: string): FreshTokenResult {
  return {
    success: false,
    message: `Your ${providerLabel} session has expired and cannot be renewed automatically. Please reconnect the account.`,
  };
}

function narrowAccountConfig(rawValue: unknown): JsonObject {
  return toJsonObject(rawValue) ?? {};
}
