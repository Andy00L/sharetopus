import "server-only";
import { storeContentHistory } from "@/actions/server/contentHistoryActions/storeContentHistory";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import type { SocialAccount } from "@/lib/types/dbTypes";
import type { Platform } from "@/lib/types/database.types";

export type DirectPostScheduleResult = {
  success: boolean;
  count: number;
  message?: string;
};

export type GenericDirectPostConfig = {
  platform: Platform;
  logPrefix: string;
  account: SocialAccount;
  accountContent: { accountId: string; title?: string; description: string };
  userId: string;
  batchId: string;
  scheduledPostId: string | null;
  postType: "image" | "video" | "text";
  createdVia: "web" | "mcp" | "x402" | "api";
};

export type DirectPostHookContext<TPostResult> = {
  postResult: TPostResult;
  historyResult: { success: boolean; message: string; recordId?: string };
  config: GenericDirectPostConfig;
};

export type DirectPostPlatformAdapter<
  TPassthrough,
  TPostResult extends {
    success: boolean;
    postId?: string;
    publishId?: string;
    postUrl?: string;
    message?: string;
    error?: string;
    details?: unknown;
  }
> = {
  validate?: (
    passthrough: TPassthrough,
    config: GenericDirectPostConfig
  ) =>
    | Promise<DirectPostScheduleResult | null>
    | DirectPostScheduleResult
    | null;

  checkRateLimit?: (
    passthrough: TPassthrough,
    config: GenericDirectPostConfig
  ) => Promise<DirectPostScheduleResult | null>;

  preparePassthrough?: (
    passthrough: TPassthrough,
    config: GenericDirectPostConfig
  ) => Promise<
    | { success: true; passthrough: TPassthrough }
    | (DirectPostScheduleResult & { success: false })
  >;

  call: (
    accessToken: string,
    passthrough: TPassthrough,
    config: GenericDirectPostConfig
  ) => Promise<TPostResult>;

  toHistoryFields: (
    postResult: TPostResult,
    passthrough: TPassthrough,
    config: GenericDirectPostConfig
  ) => {
    content_id: string;
    media_url: string | null;
    status: string;
    extra: Record<string, unknown>;
  };

  onPostSuccess?: (
    ctx: DirectPostHookContext<TPostResult>,
    passthrough: TPassthrough
  ) => Promise<void>;
};

export async function directPostForAccountsGeneric<
  TPassthrough,
  TPostResult extends {
    success: boolean;
    postId?: string;
    publishId?: string;
    postUrl?: string;
    message?: string;
    error?: string;
    details?: unknown;
  }
>(
  config: GenericDirectPostConfig,
  passthrough: TPassthrough,
  adapter: DirectPostPlatformAdapter<TPassthrough, TPostResult>
): Promise<DirectPostScheduleResult> {
  const {
    logPrefix,
    account,
    accountContent,
    userId,
    batchId,
    postType,
    platform,
  } = config;

  try {
    console.log(`${logPrefix} Starting to post directly to ${platform}`);

    if (!account) {
      console.error(`${logPrefix} No account provided`);
      return {
        success: false,
        count: 0,
        message: `No ${platform} account provided`,
      };
    }

    if (!accountContent) {
      console.error(`${logPrefix} No account content provided`);
      return {
        success: false,
        count: 0,
        message: "No content found for account",
      };
    }

    if (adapter.validate) {
      const validation = await adapter.validate(passthrough, config);
      if (validation && !validation.success) {
        return validation;
      }
    }

    if (adapter.checkRateLimit) {
      const rateLimit = await adapter.checkRateLimit(passthrough, config);
      if (rateLimit && !rateLimit.success) {
        return rateLimit;
      }
    }

    let activePassthrough = passthrough;
    if (adapter.preparePassthrough) {
      const prep = await adapter.preparePassthrough(passthrough, config);
      if (!prep.success) {
        return prep;
      }
      activePassthrough = prep.passthrough;
    }

    const validToken = await ensureValidToken(account);
    if (!validToken.success || !validToken.token) {
      console.error(
        `${logPrefix} Invalid token for account ${account.id}`
      );
      return {
        success: false,
        count: 0,
        message: validToken.error ?? "Failed to validate access token",
      };
    }

    console.log(
      `${logPrefix} Posting to account: ${account.username ?? account.id}`
    );

    const postResult = await adapter.call(
      validToken.token,
      activePassthrough,
      config
    );

    console.log(
      `========== ${platform.toUpperCase()} POST RESPONSE (${account.username ?? account.id}) ==========`
    );
    console.log("Success:", postResult.success);
    if (postResult.publishId) console.log("Publish ID:", postResult.publishId);
    if (postResult.postId) console.log("Post ID:", postResult.postId);
    if (postResult.postUrl) console.log("Post URL:", postResult.postUrl);
    if (postResult.message) console.log("Message:", postResult.message);

    if (!postResult.success) {
      console.error(`${logPrefix} Failed with error:`, postResult.error);
      if (postResult.details)
        console.error(`${logPrefix} Error details:`, postResult.details);
      if (postResult.message)
        console.error(`${logPrefix} Error message:`, postResult.message);
      return {
        success: false,
        count: 0,
        message: postResult.message ?? `Failed to post to ${platform}`,
      };
    }

    const historyFields = adapter.toHistoryFields(
      postResult,
      activePassthrough,
      config
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
      userId
    );

    if (!historyResult.success) {
      console.error(
        `${logPrefix} Failed to save history:`,
        historyResult.message
      );
      return {
        success: false,
        count: 0,
        message: `Post succeeded but failed to save history: ${historyResult.message}`,
      };
    }

    console.log(
      `${logPrefix} Successfully posted to account and saved to history`
    );

    if (adapter.onPostSuccess) {
      try {
        await adapter.onPostSuccess(
          { postResult, historyResult, config },
          activePassthrough
        );
      } catch (hookErr) {
        console.error(
          `${logPrefix} onPostSuccess hook threw (post still succeeded):`,
          hookErr instanceof Error ? hookErr.message : hookErr
        );
      }
    }

    return {
      success: true,
      count: 1,
      message: `Successfully posted to ${account.display_name ?? account.username ?? account.id}`,
    };
  } catch (error) {
    console.error(
      `${logPrefix} Unexpected error for account ${account?.id}:`,
      error instanceof Error ? error.message : error
    );
    return {
      success: false,
      count: 0,
      message:
        error instanceof Error
          ? `Failed to post to ${platform}: ${error.message}`
          : `Failed to post to ${platform}`,
    };
  }
}
