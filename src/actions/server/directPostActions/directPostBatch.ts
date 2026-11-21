import "server-only";

import { and, eq } from "drizzle-orm";

import { getServerSignedViewUrls } from "@/actions/server/data/getServerSignedViewUrl";
import {
  describeAccountMismatch,
  loadOwnedAccountPlatforms,
} from "@/actions/server/data/loadOwnedAccountPlatforms";
import { db, runQuery } from "@/db/client";
import { pending_direct_posts } from "@/db/schema";
import type { CreatedVia, MediaType, Platform } from "@/db/schema";
import { dispatchPostNowEvents } from "@/inngest/dispatch/dispatchPostNowEvents";
import type { PostNowEventData } from "@/inngest/events/postNow";
import { buildDefaultPlatformOptions } from "@/inngest/events/postOptions";
import type { PlatformOptions } from "@/lib/types/dbTypes";
import type { PostBatchFailure, PostRejection } from "@/lib/types/postBatch";
import type { PreflightResult } from "@/lib/types/preflight";
import { generateBatchId } from "@/lib/utils/generateBatchId";
import { randomUUID } from "node:crypto";
import { checkRateLimit } from "../rateLimit/checkRateLimit";
import { DIRECT_POST_BATCH_RATE_LIMIT } from "@/actions/server/rateLimit/rateLimitRules";
import { validatePostFields } from "../scheduleActions/validatePostFields";

const MAX_BATCH_SIZE = 30;

export type DirectPostData = {
  socialAccountId: string;
  platform: Platform;
  postType: MediaType;
  title?: string | null;
  description: string | null;
  mediaStoragePath: string;
  coverTimestamp?: number;
  platformOptions?: PlatformOptions;
  link?: string;
  pinterestBoardId?: string;
  pinterestBoardName?: string;
  idempotency_key?: string;
  registryOptions?: Record<string, unknown> | null;
};

export type DirectPostBatchResult = {
  message: string;
  batchId: string;
  resetIn?: number;
  details: {
    total: number;
    dispatched: number;
    duplicates: number;
    rejected: PostRejection[];
  };
  eventIds: string[];
} & ({ success: true } | { success: false; failure: PostBatchFailure });

export async function directPostBatch(
  posts: DirectPostData[],
  principalId: string,
  source: CreatedVia,
  agentSuppliedBatchId?: string,
  requestId?: string | null,
): Promise<DirectPostBatchResult> {
  const batchId = agentSuppliedBatchId ?? generateBatchId();
  const useAgentBatchId = Boolean(agentSuppliedBatchId);

  console.log(
    `[directPostBatch] [req=${requestId ?? "?"}] Starting from source="${source}" for principal=${principalId}, ${posts?.length ?? 0} post(s), batchId=${batchId}`,
  );

  const emptyDetails: DirectPostBatchResult["details"] = {
    total: 0,
    dispatched: 0,
    duplicates: 0,
    rejected: [],
  };

  try {
    if (!posts || posts.length === 0) {
      return {
        success: false,
        failure: "invalid_request",
        message: "No posts provided.",
        batchId,
        details: emptyDetails,
        eventIds: [],
      };
    }
    if (posts.length > MAX_BATCH_SIZE) {
      return {
        success: false,
        failure: "invalid_request",
        message: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} posts.`,
        batchId,
        details: { ...emptyDetails, total: posts.length },
        eventIds: [],
      };
    }

    const rateCheck = await checkRateLimit({
      operation: `${source}_direct_post_batch`,
      identifier: principalId,
      rule: DIRECT_POST_BATCH_RATE_LIMIT,
    });
    if (!rateCheck.success) {
      return {
        success: false,
        failure: rateCheck.reason === "limited" ? "rate_limited" : "unavailable",
        message: rateCheck.message,
        batchId,
        resetIn: rateCheck.resetIn,
        details: { ...emptyDetails, total: posts.length },
        eventIds: [],
      };
    }

    const rejected: PostRejection[] = [];
    const validPosts: DirectPostData[] = [];

    for (const post of posts) {
      const validationError = validateDirectPostFields(post, principalId);
      if (validationError) {
        rejected.push({
          socialAccountId: post.socialAccountId ?? "unknown",
          code: "invalid_input",
          reason: validationError,
        });
        continue;
      }
      validPosts.push(post);
    }

    if (validPosts.length === 0) {
      return {
        success: false,
        failure: "rejected",
        message: "All posts failed validation.",
        batchId,
        details: {
          total: posts.length,
          dispatched: 0,
          duplicates: 0,
          rejected,
        },
        eventIds: [],
      };
    }

    const ownership = await loadOwnedAccountPlatforms(
      validPosts.map((post) => post.socialAccountId),
      principalId,
    );
    if (!ownership.success) {
      console.error(
        `[directPostBatch] [req=${requestId ?? "?"}] ${ownership.message}`,
      );
      return {
        success: false,
        failure: "unavailable",
        message: "Could not check account ownership. Please try again.",
        batchId,
        details: {
          total: posts.length,
          dispatched: 0,
          duplicates: 0,
          rejected,
        },
        eventIds: [],
      };
    }

    const ownedPosts: DirectPostData[] = [];
    for (const post of validPosts) {
      const mismatch = describeAccountMismatch(ownership.platformByAccountId, post);
      if (mismatch) {
        rejected.push(mismatch);
      } else {
        ownedPosts.push(post);
      }
    }

    if (ownedPosts.length === 0) {
      return {
        success: false,
        failure: "rejected",
        message: "No posts owned by the principal.",
        batchId,
        details: {
          total: posts.length,
          dispatched: 0,
          duplicates: 0,
          rejected,
        },
        eventIds: [],
      };
    }

    const mediaCheck = await confirmMediaFilesExist(ownedPosts);
    if (!mediaCheck.success) {
      console.error(
        `[directPostBatch] [req=${requestId ?? "?"}] ${mediaCheck.message}`,
      );
      return {
        success: false,
        failure: "internal",
        message: "Could not prepare the media for publishing. Please try again.",
        batchId,
        details: {
          total: posts.length,
          dispatched: 0,
          duplicates: 0,
          rejected,
        },
        eventIds: [],
      };
    }

    const events = buildEventPayloads(
      ownedPosts,
      batchId,
      principalId,
      source,
      useAgentBatchId,
      requestId,
    );

    const dispatch = await dispatchPostNowEvents(events);
    if (!dispatch.success) {
      console.error(
        `[directPostBatch] [req=${requestId ?? "?"}] Dispatch failed (${dispatch.phase}):`,
        dispatch.message,
      );
      return {
        success: false,
        failure: "internal",
        message: "Could not dispatch the post. Please try again.",
        batchId,
        details: {
          total: posts.length,
          dispatched: 0,
          duplicates: 0,
          rejected,
        },
        eventIds: [],
      };
    }

    for (const refusedEvent of dispatch.refused) {
      rejected.push({
        socialAccountId: refusedEvent.socialAccountId,
        code: "invalid_input",
        reason: refusedEvent.message,
      });
    }
    const duplicates = events.length - dispatch.refused.length - dispatch.freshCount;
    if (dispatch.freshCount + duplicates === 0) {
      return {
        success: false,
        failure: "rejected",
        message: "All posts failed validation.",
        batchId,
        details: {
          total: posts.length,
          dispatched: 0,
          duplicates: 0,
          rejected,
        },
        eventIds: [],
      };
    }

    return {
      success: true,
      message: `Dispatched ${dispatch.freshCount} post(s)${duplicates > 0 ? `, ${duplicates} already existed (idempotent retry)` : ""}.`,
      batchId,
      details: {
        total: posts.length,
        dispatched: dispatch.freshCount,
        duplicates,
        rejected,
      },
      eventIds: dispatch.eventIds,
    };
  } catch (err) {
    console.error(
      `[directPostBatch] [req=${requestId ?? "?"}] Unexpected error:`,
      err instanceof Error ? err.message : err,
    );
    return {
      success: false,
      failure: "internal",
      message: "Unexpected error dispatching posts.",
      batchId,
      details: emptyDetails,
      eventIds: [],
    };
  }
}

export async function preflightDirectPost(
  post: DirectPostData,
  principalId: string,
): Promise<PreflightResult> {
  const validationError = validateDirectPostFields(post, principalId);
  if (validationError) {
    return { ok: false, httpStatus: 400, errorKind: "validation_error", message: validationError };
  }

  const ownership = await loadOwnedAccountPlatforms([post.socialAccountId], principalId);
  if (!ownership.success) {
    console.error(`[preflightDirectPost] ${ownership.message}`);
    return { ok: false, httpStatus: 500, errorKind: "precheck_failed", message: "Could not check account ownership." };
  }
  const accountPlatform = ownership.platformByAccountId.get(post.socialAccountId);
  if (!accountPlatform) {
    return {
      ok: false,
      httpStatus: 403,
      errorKind: "account_not_owned",
      message: "This social account does not belong to the paying wallet.",
    };
  }
  if (accountPlatform !== post.platform) {
    return {
      ok: false,
      httpStatus: 400,
      errorKind: "platform_mismatch",
      message: `Account platform is ${accountPlatform}, post declared ${post.platform}.`,
    };
  }

  if (post.idempotency_key) {
    const { data: existingLocks, error: lockLookupError } = await runQuery(
      db
        .select({ event_id: pending_direct_posts.event_id })
        .from(pending_direct_posts)
        .where(
          and(
            eq(pending_direct_posts.principal_id, principalId),
            eq(pending_direct_posts.idempotency_key, post.idempotency_key),
          ),
        )
        .limit(1),
    );
    if (lockLookupError) {
      console.error(`[preflightDirectPost] Idempotency lookup failed: ${lockLookupError.message}`);
      return {
        ok: false,
        httpStatus: 500,
        errorKind: "precheck_failed",
        message: "Could not check the idempotency key.",
      };
    }
    if (existingLocks.length > 0) {
      return {
        ok: false,
        httpStatus: 409,
        errorKind: "duplicate_idempotency_key",
        message: "A post with this idempotency_key was already dispatched.",
      };
    }
  }

  return { ok: true };
}

function validateDirectPostFields(
  post: DirectPostData,
  principalId: string,
): string | null {
  return validatePostFields(
    {
      socialAccountId: post.socialAccountId,
      platform: post.platform,
      postType: post.postType,
      mediaStoragePath: post.mediaStoragePath,
      description: post.description,
      link: post.link,
      pinterestBoardId: post.pinterestBoardId,
    },
    principalId,
  );
}

async function confirmMediaFilesExist(
  posts: DirectPostData[],
): Promise<{ success: true } | { success: false; message: string }> {
  const mediaPaths = posts
    .map((post) => post.mediaStoragePath)
    .filter((mediaPath) => mediaPath !== "");
  const signedUrls = await getServerSignedViewUrls(mediaPaths);
  if (!signedUrls.success) {
    return { success: false, message: `Media file check failed: ${signedUrls.message}` };
  }
  return { success: true };
}

function buildEventPayloads(
  posts: DirectPostData[],
  batchId: string,
  principalId: string,
  source: CreatedVia,
  useAgentBatchIdForIdempotency: boolean,
  requestId?: string | null,
): PostNowEventData[] {
  return posts.map((post, index) => {
    const link = post.link ?? "";
    return {
      dispatch_id: randomUUID(),
      batch_id: batchId,
      principal_id: principalId,
      social_account_id: post.socialAccountId,
      platform: post.platform,
      post_type: post.postType,
      account_content: {
        title: post.title ?? "",
        description: post.description ?? "",
        link,
      },
      platform_options:
        post.platformOptions ??
        buildDefaultPlatformOptions({ pinterestBoardId: post.pinterestBoardId, link }),
      board:
        post.platform === "pinterest"
          ? {
              boardID: post.pinterestBoardId ?? "",
              boardName: post.pinterestBoardName ?? null,
            }
          : null,
      cover_timestamp: post.coverTimestamp ?? null,
      media_path: post.mediaStoragePath,
      created_via: source,
      idempotency_key:
        post.idempotency_key ??
        (useAgentBatchIdForIdempotency ? `${batchId}:${index}` : undefined),
      request_id: requestId ?? null,
      post_options: post.registryOptions ?? null,
    };
  });
}
