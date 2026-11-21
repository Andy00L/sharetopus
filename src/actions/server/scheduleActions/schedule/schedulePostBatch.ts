import "server-only";

import { and, count, eq, gte, inArray, lte } from "drizzle-orm";

import {
  describeAccountMismatch,
  loadOwnedAccountPlatforms,
} from "@/actions/server/data/loadOwnedAccountPlatforms";
import { db, runQuery } from "@/db/client";
import { platform_quotas, scheduled_posts } from "@/db/schema";
import type { CreatedVia, PostStatus } from "@/db/schema";
import {
  POST_DUE_TARGET_COLUMNS,
  sendPostDueEvents,
} from "@/inngest/dispatch/sendPostDueEvents";
import { dispatchWebhooks } from "@/lib/api/rest/webhooks/dispatch";
import type { PostBatchFailure, PostRejection } from "@/lib/types/postBatch";
import type { PreflightResult } from "@/lib/types/preflight";
import type { SchedulePostData } from "@/lib/types/SchedulePostData";
import { generateBatchId } from "@/lib/utils/generateBatchId";
import { checkRateLimit } from "../../rateLimit/checkRateLimit";
import { SCHEDULE_POST_BATCH_RATE_LIMIT } from "@/actions/server/rateLimit/rateLimitRules";
import { validatePostFields } from "../validatePostFields";
import { countPostsByPlatform, findDailyQuotaViolation } from "./dailyQuota";

const MAX_BATCH_SIZE = 50;
const DEFAULT_PLATFORM_DAILY_CAP = 50;
const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
const QUOTA_COUNTED_STATUSES: PostStatus[] = ["scheduled", "queued", "processing"];

type ScheduledPostInsertRow = typeof scheduled_posts.$inferInsert;

export type SchedulePostBatchResult = {
  message: string;
  batchId: string;
  resetIn?: number;
  details: {
    total: number;
    inserted: number;
    duplicates: number;
    unresolvedDuplicateIds: number;
    rejected: PostRejection[];
  };
  scheduleIds: string[];
} & ({ success: true } | { success: false; failure: PostBatchFailure });

export async function schedulePostBatch(
  posts: SchedulePostData[],
  principalId: string,
  source: CreatedVia,
  requestId?: string | null,
): Promise<SchedulePostBatchResult> {
  const batchId = generateBatchId();

  console.log(
    `[schedulePostBatch] [req=${requestId ?? "?"}] Starting from source="${source}" for principal=${principalId}, ${posts?.length ?? 0} post(s) requested, batchId=${batchId}`,
  );

  const emptyDetails: SchedulePostBatchResult["details"] = {
    total: 0,
    inserted: 0,
    duplicates: 0,
    unresolvedDuplicateIds: 0,
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
        scheduleIds: [],
      };
    }

    if (posts.length > MAX_BATCH_SIZE) {
      return {
        success: false,
        failure: "invalid_request",
        message: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} posts.`,
        batchId,
        details: { ...emptyDetails, total: posts.length },
        scheduleIds: [],
      };
    }

    const rateLimitScope = `${source}_schedule_post_batch`;
    const rateCheck = await checkRateLimit({
      operation: rateLimitScope,
      identifier: principalId,
      rule: SCHEDULE_POST_BATCH_RATE_LIMIT,
    });
    if (!rateCheck.success) {
      return {
        success: false,
        failure: rateCheck.reason === "limited" ? "rate_limited" : "unavailable",
        message: rateCheck.message,
        batchId,
        resetIn: rateCheck.resetIn,
        details: { ...emptyDetails, total: posts.length },
        scheduleIds: [],
      };
    }

    const rejectedPosts: PostRejection[] = [];
    const validPosts: SchedulePostData[] = [];

    for (const post of posts) {
      const validationError = validateSchedulePostFields(post, principalId);
      if (validationError) {
        rejectedPosts.push({
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
          inserted: 0,
          duplicates: 0,
          unresolvedDuplicateIds: 0,
          rejected: rejectedPosts,
        },
        scheduleIds: [],
      };
    }

    const ownershipResult = await loadOwnedAccountPlatforms(
      validPosts.map((post) => post.socialAccountId),
      principalId,
    );
    if (!ownershipResult.success) {
      console.error(
        `[schedulePostBatch] [req=${requestId ?? "?"}] Ownership check error:`,
        ownershipResult.message,
      );
      return {
        success: false,
        failure: "unavailable",
        message: "Could not check account ownership. Please try again.",
        batchId,
        details: {
          total: posts.length,
          inserted: 0,
          duplicates: 0,
          unresolvedDuplicateIds: 0,
          rejected: rejectedPosts,
        },
        scheduleIds: [],
      };
    }

    const ownedPosts: SchedulePostData[] = [];
    for (const post of validPosts) {
      const mismatch = describeAccountMismatch(
        ownershipResult.platformByAccountId,
        post,
      );
      if (mismatch) {
        rejectedPosts.push(mismatch);
      } else {
        ownedPosts.push(post);
      }
    }

    if (ownedPosts.length === 0) {
      console.warn(
        `[schedulePostBatch] [req=${requestId ?? "?"}] No owned posts for principal=${principalId}`,
      );
      return {
        success: false,
        failure: "rejected",
        message: "No posts owned by the principal.",
        batchId,
        details: {
          total: posts.length,
          inserted: 0,
          duplicates: 0,
          unresolvedDuplicateIds: 0,
          rejected: rejectedPosts,
        },
        scheduleIds: [],
      };
    }

    const quotaCheck = await checkPlatformDailyQuotas(
      ownedPosts,
      principalId,
      requestId,
    );
    if (!quotaCheck.success) {
      return {
        success: false,
        failure: quotaCheck.failure,
        message: quotaCheck.message,
        batchId,
        details: {
          total: posts.length,
          inserted: 0,
          duplicates: 0,
          unresolvedDuplicateIds: 0,
          rejected: rejectedPosts,
        },
        scheduleIds: [],
      };
    }

    const rows = buildInsertRows(ownedPosts, principalId, source, batchId);

    const { data: inserted, error: upsertError } = await runQuery(
      db
        .insert(scheduled_posts)
        .values(rows)
        .onConflictDoNothing({
          target: [
            scheduled_posts.principal_id,
            scheduled_posts.idempotency_key,
          ],
        })
        .returning({
          ...POST_DUE_TARGET_COLUMNS,
          idempotency_key: scheduled_posts.idempotency_key,
        }),
    );

    if (upsertError) {
      console.error(
        `[schedulePostBatch] [req=${requestId ?? "?"}] Upsert error:`,
        upsertError.message,
      );
      return {
        success: false,
        failure: "internal",
        message: "Could not save the posts. Please try again.",
        batchId,
        details: {
          total: posts.length,
          inserted: 0,
          duplicates: 0,
          unresolvedDuplicateIds: 0,
          rejected: rejectedPosts,
        },
        scheduleIds: [],
      };
    }

    const insertedKeySet = new Set(inserted.map((row) => row.idempotency_key));

    const allKeys = rows
      .map((row) => row.idempotency_key)
      .filter((key): key is string => key !== null);
    const skippedKeys = allKeys.filter((key) => !insertedKeySet.has(key));

    const keyToScheduleId = new Map<string, string>();
    for (const row of inserted) {
      if (row.idempotency_key) {
        keyToScheduleId.set(row.idempotency_key, row.id);
      }
    }

    let unresolvedDuplicateIds = 0;
    if (skippedKeys.length > 0) {
      const { data: existingRows, error: fetchError } = await runQuery(
        db
          .select({
            id: scheduled_posts.id,
            idempotency_key: scheduled_posts.idempotency_key,
          })
          .from(scheduled_posts)
          .where(
            and(
              eq(scheduled_posts.principal_id, principalId),
              inArray(scheduled_posts.idempotency_key, skippedKeys),
            ),
          ),
      );

      if (fetchError) {
        unresolvedDuplicateIds = skippedKeys.length;
        console.error(
          `[schedulePostBatch] [req=${requestId ?? "?"}] ${skippedKeys.length} duplicate(s) saved earlier, but their ids could not be read:`,
          fetchError.message,
        );
      } else {
        for (const row of existingRows) {
          if (row.idempotency_key) {
            keyToScheduleId.set(row.idempotency_key, row.id);
          }
        }
      }
    }
    const duplicates = skippedKeys.length;

    const scheduleIds: string[] = [];
    for (const row of rows) {
      if (row.idempotency_key) {
        const id = keyToScheduleId.get(row.idempotency_key);
        if (id) scheduleIds.push(id);
      }
    }

    await sendPostDueEvents(inserted);

    void dispatchWebhooks(
      principalId,
      "post.scheduled",
      inserted.map((insertedRow) => ({ post_id: insertedRow.id, batch_id: batchId })),
    );

    const duplicateNote =
      duplicates === 0
        ? ""
        : unresolvedDuplicateIds > 0
          ? `, ${duplicates} already existed (idempotent retry; their ids could not be read, retry to get them)`
          : `, ${duplicates} already existed (idempotent retry)`;

    return {
      success: true,
      message: `Scheduled ${inserted.length} post(s)${duplicateNote}.`,
      batchId,
      details: {
        total: posts.length,
        inserted: inserted.length,
        duplicates,
        unresolvedDuplicateIds,
        rejected: rejectedPosts,
      },
      scheduleIds,
    };
  } catch (err) {
    console.error(
      `[schedulePostBatch] [req=${requestId ?? "?"}] Unexpected error:`,
      err instanceof Error ? err.message : err,
    );
    return {
      success: false,
      failure: "internal",
      message: "Unexpected error scheduling posts.",
      batchId,
      details: emptyDetails,
      scheduleIds: [],
    };
  }
}

export async function preflightSchedulePost(
  post: SchedulePostData,
  principalId: string,
): Promise<PreflightResult> {
  const validationError = validateSchedulePostFields(post, principalId);
  if (validationError) {
    return { ok: false, httpStatus: 400, errorKind: "validation_error", message: validationError };
  }

  const ownershipResult = await loadOwnedAccountPlatforms([post.socialAccountId], principalId);
  if (!ownershipResult.success) {
    console.error(`[preflightSchedulePost] ${ownershipResult.message}`);
    return { ok: false, httpStatus: 500, errorKind: "precheck_failed", message: "Could not check account ownership." };
  }
  const accountPlatform = ownershipResult.platformByAccountId.get(post.socialAccountId);
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

  const quotaCheck = await checkPlatformDailyQuotas([post], principalId);
  if (!quotaCheck.success) {
    return quotaCheck.failure === "quota_exceeded"
      ? { ok: false, httpStatus: 429, errorKind: "platform_quota_exceeded", message: quotaCheck.message }
      : { ok: false, httpStatus: 500, errorKind: "precheck_failed", message: quotaCheck.message };
  }

  if (post.idempotency_key) {
    const { data: existingPosts, error: lookupError } = await runQuery(
      db
        .select({ id: scheduled_posts.id })
        .from(scheduled_posts)
        .where(
          and(
            eq(scheduled_posts.principal_id, principalId),
            eq(scheduled_posts.idempotency_key, post.idempotency_key),
          ),
        )
        .limit(1),
    );
    if (lookupError) {
      console.error(`[preflightSchedulePost] Idempotency lookup failed: ${lookupError.message}`);
      return {
        ok: false,
        httpStatus: 500,
        errorKind: "precheck_failed",
        message: "Could not check the idempotency key.",
      };
    }
    if (existingPosts.length > 0) {
      return {
        ok: false,
        httpStatus: 409,
        errorKind: "duplicate_idempotency_key",
        message: "A post with this idempotency_key is already scheduled.",
      };
    }
  }

  return { ok: true };
}

function validateSchedulePostFields(
  post: SchedulePostData,
  principalId: string,
): string | null {
  if (!post.scheduledAt) return "Missing required field scheduledAt.";
  return validatePostFields(
    {
      socialAccountId: post.socialAccountId,
      platform: post.platform,
      postType: post.postType,
      mediaStoragePath: post.mediaStoragePath,
      description: post.description,
      link: post.postOptions?.link,
      pinterestBoardId: post.postOptions?.board,
    },
    principalId,
  );
}

async function checkPlatformDailyQuotas(
  posts: SchedulePostData[],
  principalId: string,
  requestId?: string | null,
): Promise<
  | { success: true }
  | { success: false; failure: "quota_exceeded" | "unavailable"; message: string }
> {
  const addedCountByPlatform = countPostsByPlatform(posts);
  const platforms = [...addedCountByPlatform.keys()];
  const now = new Date();
  const windowEnd = new Date(now.getTime() + QUOTA_WINDOW_MS);

  const { data: existingCounts, error: countError } = await runQuery(
    db
      .select({
        platform: scheduled_posts.platform,
        dueCount: count(),
      })
      .from(scheduled_posts)
      .where(
        and(
          eq(scheduled_posts.principal_id, principalId),
          inArray(scheduled_posts.platform, platforms),
          inArray(scheduled_posts.status, QUOTA_COUNTED_STATUSES),
          gte(scheduled_posts.scheduled_at, now.toISOString()),
          lte(scheduled_posts.scheduled_at, windowEnd.toISOString()),
        ),
      )
      .groupBy(scheduled_posts.platform),
  );

  if (countError) {
    console.error(
      `[checkPlatformDailyQuotas] [req=${requestId ?? "?"}] Quota count failed:`,
      countError.message,
    );
    return { success: false, failure: "unavailable", message: "Platform quota lookup failed." };
  }

  const { data: quotaRows, error: quotaError } = await runQuery(
    db
      .select({
        platform: platform_quotas.platform,
        daily_cap: platform_quotas.daily_cap,
      })
      .from(platform_quotas)
      .where(inArray(platform_quotas.platform, platforms)),
  );

  if (quotaError) {
    console.error(
      `[checkPlatformDailyQuotas] [req=${requestId ?? "?"}] Quota fetch failed:`,
      quotaError.message,
    );
    return { success: false, failure: "unavailable", message: "Platform quota lookup failed." };
  }

  const violation = findDailyQuotaViolation({
    addedCountByPlatform,
    existingCountByPlatform: new Map(
      existingCounts.map((countRow) => [countRow.platform, countRow.dueCount]),
    ),
    dailyCapByPlatform: new Map(
      quotaRows.map((quotaRow) => [quotaRow.platform, quotaRow.daily_cap]),
    ),
    defaultDailyCap: DEFAULT_PLATFORM_DAILY_CAP,
  });

  if (violation) {
    return {
      success: false,
      failure: "quota_exceeded",
      message: `Platform quota exceeded for ${violation.platform}. ${violation.existingCount} already scheduled in next 24h, adding ${violation.addedCount} would exceed daily cap of ${violation.dailyCap}.`,
    };
  }

  return { success: true };
}

function buildInsertRows(
  posts: SchedulePostData[],
  principalId: string,
  source: CreatedVia,
  batchId: string,
): ScheduledPostInsertRow[] {
  return posts.map((post, index) => ({
    principal_id: principalId,
    social_account_id: post.socialAccountId,
    platform: post.platform,
    status: "scheduled",
    scheduled_at: new Date(post.scheduledAt).toISOString(),
    post_title: post.title ?? "",
    post_description: post.description,
    post_options: post.postOptions ?? {},
    media_type: post.postType,
    media_storage_path: post.mediaStoragePath,
    cover_image_timestamp: post.coverTimestamp ?? null,
    batch_id: post.batch_id ?? batchId,
    created_via: source,
    idempotency_key: post.idempotency_key ?? `${batchId}:${index}`,
  }));
}
