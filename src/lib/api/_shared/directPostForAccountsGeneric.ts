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

export type DirectPostWarningKind =
  | "content_history_not_recorded"
  | "tiktok_pull_not_recorded"
  | "tiktok_poll_not_sent"
  | "post_success_hook_failed";

export type DirectPostWarning = {
  kind: DirectPostWarningKind;
  message: string;
};

export type DirectPostSuccess = {
  success: true;
  count: 1;
  message: string;
  failure?: undefined;
  warnings: DirectPostWarning[];
};

export type DirectPostScheduleResult = DirectPostSuccess | DirectPostRefusal;

const UNLOCATED_FAILURE: PlatformFailure = {
  reason: "unknown",
  mayHavePublished: true,
};

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

type ContentHistoryOutcome = Awaited<ReturnType<typeof storeContentHistory>>;

export type DirectPostHookContext<TPostResult> = {
  postResult: SucceededPostResult<TPostResult>;
  historyResult: ContentHistoryOutcome;
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
  ) => Promise<DirectPostWarning[]>;
};

type PublishedPost<TPassthrough, TPostResult extends AdapterPostResult> = {
  config: GenericDirectPostConfig;
  adapter: DirectPostPlatformAdapter<TPassthrough, TPostResult>;
  postResult: SucceededPostResult<TPostResult>;
  passthrough: TPassthrough;
};

type PreparedPublish<TPassthrough> =
  | { success: true; accessToken: string; passthrough: TPassthrough }
  | DirectPostRefusal;

function describeThrown(thrownError: unknown): string {
  return thrownError instanceof Error ? thrownError.message : String(thrownError);
}

async function prepareForPublish<TPassthrough, TPostResult extends AdapterPostResult>(
  config: GenericDirectPostConfig,
  passthrough: TPassthrough,
  adapter: DirectPostPlatformAdapter<TPassthrough, TPostResult>,
): Promise<PreparedPublish<TPassthrough>> {
  const { logPrefix, account, accountContent, platform } = config;
  try {
    if (!accountContent) {
      console.error(`${logPrefix} No account content provided`);
      return buildDirectPostRefusal("No content found for account", "invalid_input");
    }

    const validation = adapter.validate?.(passthrough, config);
    if (validation) {
      return validation;
    }

    const preparation = adapter.preparePassthrough
      ? await adapter.preparePassthrough(passthrough, config)
      : { success: true as const, passthrough };
    if (!preparation.success) {
      return preparation;
    }

    const validToken = await ensureValidToken(account);
    if (!validToken.success) {
      console.error(`${logPrefix} Invalid token for account ${account.id}`);
      return buildDirectPostRefusal(validToken.error, validToken.failureReason);
    }

    return {
      success: true,
      accessToken: validToken.token,
      passthrough: preparation.passthrough,
    };
  } catch (preparationError) {
    console.error(
      `${logPrefix} Preparation threw before any platform request for account ${account.id}:`,
      describeThrown(preparationError),
    );
    return buildDirectPostRefusal(
      `Failed to post to ${platform}: ${describeThrown(preparationError)}`,
      "transient",
    );
  }
}

export async function directPostForAccountsGeneric<
  TPassthrough,
  TPostResult extends AdapterPostResult,
>(
  config: GenericDirectPostConfig,
  passthrough: TPassthrough,
  adapter: DirectPostPlatformAdapter<TPassthrough, TPostResult>,
): Promise<DirectPostScheduleResult> {
  const { logPrefix, account, platform } = config;

  console.log(`${logPrefix} Starting to post directly to ${platform}`);

  const prepared = await prepareForPublish(config, passthrough, adapter);
  if (!prepared.success) {
    return prepared;
  }

  console.log(`${logPrefix} Posting to account: ${account.username ?? account.id}`);

  let postResult: TPostResult;
  try {
    postResult = await adapter.call(prepared.accessToken, prepared.passthrough, config);
  } catch (callError) {
    console.error(
      `${logPrefix} Threw after the platform request started for account ${account.id}:`,
      describeThrown(callError),
    );
    return {
      success: false,
      count: 0,
      message: `Failed to post to ${platform}: ${describeThrown(callError)}`,
      failure: UNLOCATED_FAILURE,
    };
  }

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

  const warnings = await recordPublishedPost({
    config,
    adapter,
    postResult,
    passthrough: prepared.passthrough,
  });

  return {
    success: true,
    count: 1,
    message: `Successfully posted to ${account.display_name ?? account.username ?? account.id}`,
    warnings,
  };
}

async function recordPublishedPost<TPassthrough, TPostResult extends AdapterPostResult>(
  input: PublishedPost<TPassthrough, TPostResult>,
): Promise<DirectPostWarning[]> {
  const { config, adapter, postResult, passthrough } = input;
  const historyResult = await storePublishedHistory(input);
  const historyWarnings: DirectPostWarning[] = historyResult.success
    ? []
    : [{ kind: "content_history_not_recorded", message: historyResult.message }];

  if (!adapter.onPostSuccess) {
    return historyWarnings;
  }
  try {
    const hookWarnings = await adapter.onPostSuccess(
      { postResult, historyResult, config },
      passthrough,
    );
    return [...historyWarnings, ...hookWarnings];
  } catch (hookError) {
    console.error(
      `${config.logPrefix} onPostSuccess hook threw (post still succeeded):`,
      describeThrown(hookError),
    );
    return [
      ...historyWarnings,
      { kind: "post_success_hook_failed", message: describeThrown(hookError) },
    ];
  }
}

async function storePublishedHistory<TPassthrough, TPostResult extends AdapterPostResult>(
  input: PublishedPost<TPassthrough, TPostResult>,
): Promise<ContentHistoryOutcome> {
  const { config, adapter, postResult, passthrough } = input;
  const { logPrefix, account, accountContent, platform } = config;
  const publishedPostLabel =
    `platform=${platform} account=${account.id} ` +
    `scheduled_post_id=${config.scheduledPostId ?? "none"}`;

  try {
    const historyFields = adapter.toHistoryFields(postResult, passthrough, config);
    const historyResult = await storeContentHistory(
      {
        platform,
        content_id: historyFields.content_id,
        social_account_id: accountContent.accountId,
        title: accountContent.title ?? null,
        description: accountContent.description ?? null,
        media_url: historyFields.media_url,
        batch_id: config.batchId,
        scheduled_post_id: config.scheduledPostId,
        status: historyFields.status,
        media_type: config.postType,
        extra: historyFields.extra,
        created_via: config.createdVia,
      },
      config.userId,
    );
    if (!historyResult.success) {
      console.error(
        `${logPrefix} CONTENT HISTORY NOT RECORDED for a published post ` +
          `(${publishedPostLabel} content_id=${historyFields.content_id}): ${historyResult.message}`,
      );
    }
    return historyResult;
  } catch (historyError) {
    console.error(
      `${logPrefix} CONTENT HISTORY NOT RECORDED for a published post ` +
        `(${publishedPostLabel}): ${describeThrown(historyError)}`,
    );
    return { success: false, message: describeThrown(historyError) };
  }
}
