import "server-only";

import { storeContentHistory } from "@/actions/server/contentHistoryActions/storeContentHistory";
import type { CreatedVia, MediaType, Platform } from "@/db/schema";
import { describePostFailure } from "@/lib/api/_shared/describePostFailure";
import type {
  PlatformFailure,
  PlatformFailureReason,
} from "@/lib/api/_shared/platformFailure";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import type { SocialAccount } from "@/lib/types/dbTypes";

export type DirectPostRefusal = {
  success: false;
  count: 0;
  message: string;
  failure: PlatformFailure;
};

export type DirectPostScheduleResult =
  | { success: true; count: 1; message: string; failure?: undefined }
  | DirectPostRefusal;

const UNLOCATED_FAILURE: PlatformFailure = {
  reason: "unknown",
  mayHavePublished: true,
};

/** A refusal decided before any platform request, so nothing was published. */
export function buildDirectPostRefusal(
  message: string,
  reason: PlatformFailureReason,
): DirectPostRefusal {
  return {
    success: false,
    count: 0,
    message,
    failure: { reason, mayHavePublished: false },
  };
}

export type GenericDirectPostConfig = {
  platform: Platform;
  logPrefix: string;
  account: SocialAccount;
  accountContent: { accountId: string; title?: string; description: string };
  userId: string;
  batchId: string;
  scheduledPostId: string | null;
  postType: MediaType;
  createdVia: CreatedVia;
};

export type DirectPostHookContext<TPostResult> = {
  postResult: SucceededPostResult<TPostResult>;
  historyResult: { success: boolean; message: string; recordId?: string };
  config: GenericDirectPostConfig;
};

type AdapterPostResult = {
  success: boolean;
  postId?: string;
  publishId?: string;
  postUrl?: string;
  message?: string;
  error?: string;
  details?: unknown;
  failure?: PlatformFailure;
};

type SucceededPostResult<TPostResult> = Exclude<TPostResult, { success: false }>;

function isPostSucceeded<TPostResult extends AdapterPostResult>(
  postResult: TPostResult,
): postResult is SucceededPostResult<TPostResult> {
  return postResult.success;
}

export type DirectPostPlatformAdapter<
  TPassthrough,
  TPostResult extends AdapterPostResult,
> = {
  validate?: (
    passthrough: TPassthrough,
    config: GenericDirectPostConfig,
  ) => DirectPostRefusal | null;

  preparePassthrough?: (
    passthrough: TPassthrough,
    config: GenericDirectPostConfig,
  ) => Promise<{ success: true; passthrough: TPassthrough } | DirectPostRefusal>;

  call: (
    accessToken: string,
    passthrough: TPassthrough,
    config: GenericDirectPostConfig,
  ) => Promise<TPostResult>;

  toHistoryFields: (
    postResult: SucceededPostResult<TPostResult>,
    passthrough: TPassthrough,
    config: GenericDirectPostConfig,
  ) => {
    content_id: string;
    media_url: string | null;
    status: string;
    extra: Record<string, unknown>;
  };

  onPostSuccess?: (
    hookContext: DirectPostHookContext<TPostResult>,
    passthrough: TPassthrough,
  ) => Promise<void>;
};

/** Shared direct-post flow: validate, refresh the token, call the platform adapter, record content history. */
export async function directPostForAccountsGeneric<
  TPassthrough,
  TPostResult extends AdapterPostResult,
>(
  config: GenericDirectPostConfig,
  passthrough: TPassthrough,
  adapter: DirectPostPlatformAdapter<TPassthrough, TPostResult>,
): Promise<DirectPostScheduleResult> {
  const { logPrefix, account, accountContent, userId, batchId, postType, platform } =
    config;

  try {
    console.log(`${logPrefix} Starting to post directly to ${platform}`);

    if (!accountContent) {
      console.error(`${logPrefix} No account content provided`);
      return buildDirectPostRefusal("No content found for account", "invalid_input");
    }

    const validation = adapter.validate?.(passthrough, config);
    if (validation) {
      return validation;
    }

    let activePassthrough = passthrough;
    if (adapter.preparePassthrough) {
      const preparation = await adapter.preparePassthrough(passthrough, config);
      if (!preparation.success) {
        return preparation;
      }
      activePassthrough = preparation.passthrough;
    }

    const validToken = await ensureValidToken(account);
    if (!validToken.success) {
      console.error(`${logPrefix} Invalid token for account ${account.id}`);
      return buildDirectPostRefusal(validToken.error, validToken.failureReason);
    }

    console.log(
      `${logPrefix} Posting to account: ${account.username ?? account.id}`,
    );

    const postResult = await adapter.call(
      validToken.token,
      activePassthrough,
      config,
    );

    if (!isPostSucceeded(postResult)) {
      const failure = postResult.failure ?? UNLOCATED_FAILURE;
      console.error(
        `${logPrefix} Failed for account ${account.id} (reason=${failure.reason}, may_have_published=${failure.mayHavePublished}):`,
        postResult.error,
        postResult.details ?? "",
      );
      return {
        success: false,
        count: 0,
        message: describePostFailure(postResult, platform),
        failure,
      };
    }

    console.log(`${logPrefix} Posted for ${account.username ?? account.id}:`, {
      publishId: postResult.publishId,
      postId: postResult.postId,
      postUrl: postResult.postUrl,
    });

    const historyFields = adapter.toHistoryFields(
      postResult,
      activePassthrough,
      config,
    );

    const historyResult = await storeContentHistory(
      {
        platform,
        content_id: historyFields.content_id,
        social_account_id: accountContent.accountId,
        title: accountContent.title ?? null,
        description: accountContent.description ?? null,
        media_url: historyFields.media_url,
        batch_id: batchId,
        scheduled_post_id: config.scheduledPostId,
        status: historyFields.status,
        media_type: postType,
        extra: historyFields.extra,
        created_via: config.createdVia,
      },
      userId,
    );

    if (!historyResult.success) {
      // The post is live, so this still reports success: a failure would fire post.failed and invite a duplicate repost.
      console.error(
        `${logPrefix} CONTENT HISTORY NOT RECORDED for a published post ` +
          `(platform=${platform} account=${account.id} ` +
          `scheduled_post_id=${config.scheduledPostId ?? "none"} ` +
          `content_id=${historyFields.content_id}): ${historyResult.message}`,
      );
    }

    if (adapter.onPostSuccess) {
      try {
        await adapter.onPostSuccess(
          { postResult, historyResult, config },
          activePassthrough,
        );
      } catch (hookError) {
        console.error(
          `${logPrefix} onPostSuccess hook threw (post still succeeded):`,
          hookError instanceof Error ? hookError.message : hookError,
        );
      }
    }

    return {
      success: true,
      count: 1,
      message: `Successfully posted to ${account.display_name ?? account.username ?? account.id}`,
    };
  } catch (unexpectedError) {
    console.error(
      `${logPrefix} Unexpected error for account ${account.id}:`,
      unexpectedError instanceof Error ? unexpectedError.message : unexpectedError,
    );
    return {
      success: false,
      count: 0,
      message:
        unexpectedError instanceof Error
          ? `Failed to post to ${platform}: ${unexpectedError.message}`
          : `Failed to post to ${platform}`,
      failure: UNLOCATED_FAILURE,
    };
  }
}
