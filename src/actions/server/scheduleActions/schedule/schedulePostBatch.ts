// src/actions/server/scheduleActions/schedule/schedulePostBatch.ts
import "server-only";

import { and, eq, gte, inArray, lte } from "drizzle-orm";

import {
  describeAccountMismatch,
  loadOwnedAccountPlatforms,
} from "@/actions/server/data/loadOwnedAccountPlatforms";
import { resolvePlatformTextLimit } from "@/components/core/create/constants/captionLimits";
import { db, runQuery } from "@/db/client";
import { platform_quotas, scheduled_posts } from "@/db/schema";
import type { CreatedVia, Json } from "@/db/schema";
import { dispatchWebhook } from "@/lib/api/rest/webhooks/dispatch";
import type { PostBatchFailure, PostRejection } from "@/lib/types/postBatch";
import type { PreflightResult } from "@/lib/types/preflight";
import type { SchedulePostData } from "@/lib/types/SchedulePostData";
import { generateBatchId } from "@/lib/utils/generateBatchId";
import { checkRateLimit } from "../../rateLimit/checkRateLimit";

const MAX_BATCH_SIZE = 50;
const RATE_LIMIT = 10;
const RATE_WINDOW_SECONDS = 60;
const DEFAULT_PLATFORM_DAILY_CAP = 50;

type ScheduledPostInsertRow = typeof scheduled_posts.$inferInsert;

/**
 * A failed batch carries `failure` (see PostBatchFailure) so each caller can
 * answer in its own terms; `message` is safe to show and never carries a
 * database error.
 */
export type SchedulePostBatchResult = {
  message: string;
  batchId: string;
  resetIn?: number;
  details: {
    total: number;
    inserted: number;
    duplicates: number;
    rejected: PostRejection[];
  };
  scheduleIds: string[];
} & ({ success: true } | { success: false; failure: PostBatchFailure });

/**
 * Schedules N posts in a single batch. Shared core for web/MCP/x402.
 *
 * **Authentication:** Does not call Clerk. Caller must validate `principalId`.
 * **Rate limiting:** 10 calls per 60s per source (anti-spam). N posts = 1 call.
 * **Tables:** social_accounts (ownership + platform match), platform_quotas
 *             (daily cap), scheduled_posts (bulk insert).
 *
 * Flow:
 *   1. Size + per-post field validation. Partial success accepted.
 *   2. Rate limit (anti-spam button mash, not anti-batch).
 *   3. Ownership + platform match: 1 query for all unique
 *      social_account_ids; a post whose account is on another platform is
 *      rejected, as directPostBatch does.
 *   4. Platform daily quota: existing posts in next 24h + new <= daily_cap.
 *   5. Build rows with idempotency_key = `${batchId}:${index}`.
 *   6. Bulk insert, ON CONFLICT (principal_id, idempotency_key) DO NOTHING.
 *   7. Fetch pre-existing rows for skipped keys (duplicate detection).
 *
 * Single post = batch with N=1. Same code path, same rate limit cost.
 *
 * @param posts - Up to 50 posts
 * @param principalId - Owner (caller-validated)
 * @param source - Drives rate-limit scope and `created_via` column
 */
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

  const emptyDetails = {
    total: 0,
    inserted: 0,
    duplicates: 0,
    rejected: [] as PostRejection[],
  };

  try {
    // Step 0: shape checks
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

    // Step 1: rate limit (anti-spam, not anti-batch). A limiter that could
    // not answer is not the caller's doing, so it is not "too many requests".
    const rateLimitScope = `${source}_schedule_post_batch`;
    const rateCheck = await checkRateLimit(
      rateLimitScope,
      principalId,
      RATE_LIMIT,
      RATE_WINDOW_SECONDS,
    );
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

    // Step 2: per-post field validation, partial success
    const rejectedPosts: PostRejection[] = [];
    const validPosts: SchedulePostData[] = [];

    for (const post of posts) {
      const validationError = validatePostFields(post, principalId);
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
          rejected: rejectedPosts,
        },
        scheduleIds: [],
      };
    }

    // Step 3: ownership + platform match (1 query, IN(...))
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
          rejected: rejectedPosts,
        },
        scheduleIds: [],
      };
    }

    // Step 4: platform daily quota (applies to all sources: web, mcp, x402)
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
          rejected: rejectedPosts,
        },
        scheduleIds: [],
      };
    }

    // Step 5: build rows
    const rows = buildInsertRows(ownedPosts, principalId, source, batchId);

    // Step 6: bulk insert. A row whose (principal_id, idempotency_key)
    // already exists is skipped (unique constraint
    // scheduled_posts_principal_idem_uq) and is absent from the returned rows.
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
          id: scheduled_posts.id,
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
          rejected: rejectedPosts,
        },
        scheduleIds: [],
      };
    }

    const insertedKeySet = new Set(inserted.map((row) => row.idempotency_key));

    // Step 7: detect duplicates by fetching skipped keys
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

    let duplicates = 0;
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
        console.error(
          `[schedulePostBatch] [req=${requestId ?? "?"}] Failed to fetch duplicate IDs:`,
          fetchError.message,
        );
        // Non-fatal: the inserts already succeeded. Caller just won't get
        // the schedule_ids of the duplicates.
      } else {
        for (const row of existingRows) {
          if (row.idempotency_key) {
            keyToScheduleId.set(row.idempotency_key, row.id);
            duplicates++;
          }
        }
      }
    }

    // Step 8: collect scheduleIds in input post order
    const scheduleIds: string[] = [];
    for (const row of rows) {
      if (row.idempotency_key) {
        const id = keyToScheduleId.get(row.idempotency_key);
        if (id) scheduleIds.push(id);
      }
    }

    // Dispatch post.scheduled webhook for each newly inserted post.
    for (const insertedRow of inserted) {
      dispatchWebhook(principalId, "post.scheduled", {
        post_id: insertedRow.id,
        batch_id: batchId,
      });
    }

    return {
      success: true,
      message: `Scheduled ${inserted.length} post(s)${duplicates > 0 ? `, ${duplicates} already existed (idempotent retry)` : ""}.`,
      batchId,
      details: {
        total: posts.length,
        inserted: inserted.length,
        duplicates,
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

/**
 * Pre-payment check for one post: the field, media-path, ownership,
 * platform-match and daily-quota rules schedulePostBatch applies, plus a
 * duplicate idempotency key, without the rate limit or the insert. A paid
 * caller (x402 schedule) runs it before settlement so a post that cannot be
 * scheduled costs nothing. schedulePostBatch still enforces the same rules
 * when it runs.
 */
export async function preflightSchedulePost(
  post: SchedulePostData,
  principalId: string,
): Promise<PreflightResult> {
  const validationError = validatePostFields(post, principalId);
  if (validationError) {
    return { ok: false, httpStatus: 400, errorKind: "validation_error", message: validationError };
  }

  // Scheduling itself accepts any caption length, but the platform rejects
  // an oversized one at publish time, and a publish-time failure is not
  // refunded. A paid caller learns it now instead.
  if (post.description) {
    const captionLimit = resolvePlatformTextLimit(post.platform);
    if (post.description.length > captionLimit) {
      return {
        ok: false,
        httpStatus: 400,
        errorKind: "validation_error",
        message: `Caption exceeds ${post.platform} limit of ${captionLimit} chars (got ${post.description.length}).`,
      };
    }
  }

  const ownershipResult = await loadOwnedAccountPlatforms([post.socialAccountId], principalId);
  if (!ownershipResult.success) {
    return { ok: false, httpStatus: 500, errorKind: "precheck_failed", message: ownershipResult.message };
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

  // The insert skips an already-used key and reports success, so a paid
  // retry with the same key would be charged for a post it never gets.
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
      return {
        ok: false,
        httpStatus: 500,
        errorKind: "precheck_failed",
        message: `Idempotency lookup failed: ${lookupError.message}`,
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

// ---------- private helpers ----------

/**
 * Returns null if valid, error message string if invalid.
 * Checks required fields + Pinterest-specific rules.
 */
function validatePostFields(
  post: SchedulePostData,
  principalId: string,
): string | null {
  if (
    !post.socialAccountId ||
    !post.platform ||
    !post.scheduledAt ||
    !post.postType
  ) {
    return "Missing required fields (socialAccountId, platform, scheduledAt, postType).";
  }

  if (post.postType !== "text" && !post.mediaStoragePath) {
    return `Media file is required for ${post.postType} posts.`;
  }

  // Vuln 1 fix: prevent cross-user media file reference.
  // Storage paths are scoped {principalId}/<filename>. Reject anything else.
  if (
    post.mediaStoragePath &&
    !post.mediaStoragePath.startsWith(`${principalId}/`)
  ) {
    return "Media path is not owned by the calling principal.";
  }

  const opts = post.postOptions as Record<string, unknown> | null | undefined;
  const hasPinterestBoard = Boolean(opts?.board);
  const hasPinterestLink = Boolean(opts?.link);

  if (post.platform === "pinterest" && !hasPinterestBoard) {
    return "Pinterest posts require a board ID in postOptions.board.";
  }
  if (
    post.platform !== "pinterest" &&
    (hasPinterestBoard || hasPinterestLink)
  ) {
    return "Pinterest-specific options (board, link) only valid when platform='pinterest'.";
  }

  return null;
}

/**
 * Per-platform daily cap enforcement. Counts existing scheduled_posts in the
 * next 24h for each (principal, platform), adds N from this batch, compares
 * to platform_quotas.daily_cap. Fails on first violation.
 *
 * Applies to web, mcp, and x402 alike.
 */
async function checkPlatformDailyQuotas(
  posts: SchedulePostData[],
  principalId: string,
  requestId?: string | null,
): Promise<
  | { success: true }
  | { success: false; failure: "quota_exceeded" | "unavailable"; message: string }
> {
  const platforms = [...new Set(posts.map((post) => post.platform))];
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  for (const platform of platforms) {
    const postsForPlatform = posts.filter(
      (post) => post.platform === platform,
    ).length;

    const { data: existingCount, error: countError } = await runQuery(
      db.$count(
        scheduled_posts,
        and(
          eq(scheduled_posts.principal_id, principalId),
          eq(scheduled_posts.platform, platform),
          gte(scheduled_posts.scheduled_at, now.toISOString()),
          lte(scheduled_posts.scheduled_at, tomorrow.toISOString()),
        ),
      ),
    );

    if (countError) {
      console.error(
        `[schedulePostBatch] [req=${requestId ?? "?"}] Quota count failed for ${platform}:`,
        countError.message,
      );
      return { success: false, failure: "unavailable", message: "Platform quota lookup failed." };
    }

    const { data: quotaRows, error: quotaError } = await runQuery(
      db
        .select({ daily_cap: platform_quotas.daily_cap })
        .from(platform_quotas)
        .where(eq(platform_quotas.platform, platform))
        .limit(1),
    );

    if (quotaError) {
      console.error(
        `[schedulePostBatch] [req=${requestId ?? "?"}] Quota fetch failed for ${platform}:`,
        quotaError.message,
      );
      return { success: false, failure: "unavailable", message: "Platform quota lookup failed." };
    }

    // No platform_quotas row for this platform: the default cap applies.
    const quota = quotaRows[0];
    const dailyCap = quota?.daily_cap ?? DEFAULT_PLATFORM_DAILY_CAP;
    const totalAfter = existingCount + postsForPlatform;

    if (totalAfter > dailyCap) {
      return {
        success: false,
        failure: "quota_exceeded",
        message: `Platform quota exceeded for ${platform}. ${existingCount} already scheduled in next 24h, adding ${postsForPlatform} would exceed daily cap of ${dailyCap}.`,
      };
    }
  }

  return { success: true };
}

/**
 * Pure: builds the insert array. Per-post `idempotency_key = ${batchId}:${index}`
 * unless the caller supplied one (idempotent retries from the agent layer).
 */
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
    post_options: (post.postOptions ?? {}) as Json,
    media_type: post.postType,
    media_storage_path: post.mediaStoragePath,
    cover_image_timestamp: post.coverTimestamp ?? null,
    batch_id: post.batch_id ?? batchId,
    created_via: source,
    idempotency_key: post.idempotency_key ?? `${batchId}:${index}`,
  }));
}
