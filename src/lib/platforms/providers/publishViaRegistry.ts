import "server-only";

import { eq } from "drizzle-orm";

import { storeContentHistory } from "@/actions/server/contentHistoryActions/storeContentHistory";
import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import type {
  CreatedVia,
  MediaType,
  SocialAccount,
} from "@/lib/types/database.types";

import { resolveConfiguredProvider } from "./registry";
import type { ProviderDefinition } from "./types";

/**
 * Publishes one scheduled post through a registry provider. This is the
 * worker-side counterpart of directPostForAccountsGeneric for the 21
 * registry channels: resolve provider, ensure a fresh credential, publish,
 * record content history.
 *
 * Contracts carried over from the legacy flow, on purpose:
 *   - Refresh-token rotation: a rotated token that cannot be persisted is
 *     a RECONNECT REQUIRED log line, and the in-hand token is still used
 *     for this post (same rule ensureValidToken follows).
 *   - A published post whose content_history write fails is still a
 *     SUCCESS; the missing row is logged for reconciliation. Reporting it
 *     as failure made the worker mark live content as failed and invite a
 *     duplicate repost (audit finding 8).
 *   - Errors as values; the return shape matches DirectPostScheduleResult
 *     so classifyDirectPostFailure keeps working on the message.
 *
 * Called by: processSinglePostHelpers.callPlatformDirectPost (default arm).
 * Tables touched: social_accounts (token refresh persist), content_history
 * (via storeContentHistory).
 */

/** Refresh when the stored token dies within this window (same 5 minutes
 * ensureValidToken uses, so both paths agree on "about to expire"). */
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

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
  /** Post kind ("text" | "image" | "video"), not the MIME type. */
  mediaType: MediaType;
  mediaUrl: string | null;
  fileName: string;
  mediaMimeType: string;
  /** Per-post provider options (subreddit, communityId, ...). */
  options: unknown;
  batchId: string;
  /** Null for direct (post-now) publishes with no scheduled_posts row. */
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

/**
 * Returns a credential valid for this publish, refreshing and persisting
 * first when the stored one is expired or about to expire.
 *
 * Registry providers with no refresh function either never expire
 * (credentials providers store null expiry, so the expiry check is never
 * true) or require a reconnect once expired (Threads).
 */
async function ensureFreshRegistryToken(
  provider: ProviderDefinition,
  account: SocialAccount,
): Promise<FreshTokenResult> {
  const logPrefix = `[publishViaRegistry ${account.platform}]`;

  if (!account.access_token) {
    return {
      success: false,
      message: `Your ${provider.label} account needs to be reconnected.`,
    };
  }

  const isExpired =
    account.token_expires_at !== null &&
    Date.now() + TOKEN_EXPIRY_BUFFER_MS >=
      new Date(account.token_expires_at).getTime();

  if (!isExpired) {
    return { success: true, accessToken: account.access_token };
  }

  if (!provider.refresh || !account.refresh_token) {
    return {
      success: false,
      message: `Your ${provider.label} session has expired and cannot be renewed automatically. Please reconnect the account.`,
    };
  }

  const refreshed = await provider.refresh(account.refresh_token);
  if (!refreshed.ok) {
    return {
      success: false,
      message: `Unable to refresh your ${provider.label} connection: ${refreshed.message}`,
    };
  }

  const nextRefreshToken = refreshed.refreshToken ?? account.refresh_token;
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
    // Same asymmetry ensureValidToken documents: the in-hand token still
    // works for THIS post, but a rotated refresh token that was not
    // persisted means the stored credential chain is now dead.
    const rotated =
      Boolean(refreshed.refreshToken) &&
      refreshed.refreshToken !== account.refresh_token;
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

/**
 * Narrows a Json column value to the flat object shape providers take.
 * Non-object values (null, arrays, scalars) degrade to {} so a malformed
 * row cannot throw inside a provider.
 */
function narrowAccountConfig(rawValue: unknown): Record<string, unknown> {
  if (
    rawValue !== null &&
    typeof rawValue === "object" &&
    !Array.isArray(rawValue)
  ) {
    return rawValue as Record<string, unknown>;
  }
  return {};
}
