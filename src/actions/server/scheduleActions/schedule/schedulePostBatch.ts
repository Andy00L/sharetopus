// src/actions/server/scheduleActions/schedule/schedulePostBatch.ts
import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { generateBatchId } from "@/lib/utils/generateBatchId";
import type {
  CreatedVia,
  Json,
  TablesInsert,
} from "@/lib/types/database.types";
import type { SchedulePostData } from "@/lib/types/SchedulePostData";
import { checkRateLimit } from "../../rateLimit/checkRateLimit";

const MAX_BATCH_SIZE = 50;
const RATE_LIMIT = 10;
const RATE_WINDOW_SECONDS = 60;
const DEFAULT_PLATFORM_DAILY_CAP = 50;

type ScheduledPostInsertRow = TablesInsert<"scheduled_posts">;

export type SchedulePostBatchResult = {
  success: boolean;
  message: string;
  batchId: string;
  resetIn?: number;
  details: {
    total: number;
    inserted: number;
    duplicates: number;
    rejected: { socialAccountId: string; reason: string }[];
  };
  scheduleIds: string[];
};

/**
 * Schedules N posts in a single batch. Shared core for web/MCP/x402.
 *
 * **Authentication:** Does not call Clerk. Caller must validate `principalId`.
 * **Rate limiting:** 10 calls per 60s per source (anti-spam). N posts = 1 call.
 * **Tables:** social_accounts (ownership), platform_quotas (daily cap),
 *             scheduled_posts (bulk upsert).
 *
 * Flow:
 *   1. Size + per-post field validation. Partial success accepted.
 *   2. Rate limit (anti-spam button mash, not anti-batch).
 *   3. Ownership check: 1 query for all unique social_account_ids.
 *   4. Platform daily quota: existing posts in next 24h + new <= daily_cap.
 *   5. Build rows with idempotency_key = `${batchId}:${index}`.
 *   6. Bulk upsert with ignoreDuplicates on (principal_id, idempotency_key).
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
): Promise<SchedulePostBatchResult> {
  const batchId = generateBatchId();

  console.log(
    `[schedulePostBatch] Starting from source="${source}" for principal=${principalId}, ${posts?.length ?? 0} post(s) requested, batchId=${batchId}`,
  );

  const emptyDetails = { total: 0, inserted: 0, duplicates: 0, rejected: [] };

  try {
    // Step 0: shape checks
    if (!posts || posts.length === 0) {
      return {
        success: false,
        message: "No posts provided.",
        batchId,
        details: emptyDetails,
        scheduleIds: [],
      };
    }

    if (posts.length > MAX_BATCH_SIZE) {
      return {
        success: false,
        message: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} posts.`,
        batchId,
        details: { ...emptyDetails, total: posts.length },
        scheduleIds: [],
      };
    }

    // Step 1: rate limit (anti-spam, not anti-batch)
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
        message: "Too many schedule requests. Please try again later.",
        batchId,
        resetIn: rateCheck.resetIn,
        details: { ...emptyDetails, total: posts.length },
        scheduleIds: [],
      };
    }

    // Step 2: per-post field validation, partial success
    const rejectedPosts: { socialAccountId: string; reason: string }[] = [];
    const validPosts: SchedulePostData[] = [];

    for (const post of posts) {
      const validationError = validatePostFields(post);
      if (validationError) {
        rejectedPosts.push({
          socialAccountId: post.socialAccountId ?? "unknown",
          reason: validationError,
        });
        continue;
      }
      validPosts.push(post);
    }

    if (validPosts.length === 0) {
      return {
        success: false,
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

    // Step 3: ownership check (1 query, IN(...))
    const ownershipResult = await checkOwnership(
      validPosts.map((post) => post.socialAccountId),
      principalId,
    );
    if (!ownershipResult.success) {
      console.error(
        `[schedulePostBatch] Ownership check error:`,
        ownershipResult.message,
      );
      return {
        success: false,
        message: ownershipResult.message,
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
      if (ownershipResult.ownedIds.has(post.socialAccountId)) {
        ownedPosts.push(post);
      } else {
        rejectedPosts.push({
          socialAccountId: post.socialAccountId,
          reason: "You do not own this social account.",
        });
      }
    }

    if (ownedPosts.length === 0) {
      console.warn(
        `[schedulePostBatch] No owned posts for principal=${principalId}`,
      );
      return {
        success: false,
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
    const quotaCheck = await checkPlatformDailyQuotas(ownedPosts, principalId);
    if (!quotaCheck.success) {
      return {
        success: false,
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

    // Step 6: bulk upsert with onConflict ignore
    const { data: insertedRows, error: upsertError } = await adminSupabase
      .from("scheduled_posts")
      .upsert(rows, {
        onConflict: "principal_id,idempotency_key",
        ignoreDuplicates: true,
      })
      .select("id, idempotency_key");

    if (upsertError) {
      console.error(`[schedulePostBatch] Upsert error:`, upsertError.message);
      return {
        success: false,
        message: `Failed to insert posts: ${upsertError.message}`,
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

    const inserted = insertedRows ?? [];
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
      const { data: existingRows, error: fetchError } = await adminSupabase
        .from("scheduled_posts")
        .select("id, idempotency_key")
        .eq("principal_id", principalId)
        .in("idempotency_key", skippedKeys);

      if (fetchError) {
        console.error(
          `[schedulePostBatch] Failed to fetch duplicate IDs:`,
          fetchError.message,
        );
        // Non-fatal: the inserts already succeeded. Caller just won't get
        // the schedule_ids of the duplicates.
      } else {
        for (const row of existingRows ?? []) {
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
      `[schedulePostBatch] Unexpected error:`,
      err instanceof Error ? err.message : err,
    );
    return {
      success: false,
      message: "Unexpected error scheduling posts.",
      batchId,
      details: emptyDetails,
      scheduleIds: [],
    };
  }
}

// ---------- private helpers ----------

/**
 * Returns null if valid, error message string if invalid.
 * Checks required fields + Pinterest-specific rules.
 */
function validatePostFields(post: SchedulePostData): string | null {
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

  const opts = post.postOptions as Record<string, unknown> | null | undefined;
  const hasPinterestBoard = Boolean(opts?.board_id);
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
 * Single query: returns the set of social_account_ids owned by principalId.
 */
async function checkOwnership(
  socialAccountIds: string[],
  principalId: string,
): Promise<
  { success: true; ownedIds: Set<string> } | { success: false; message: string }
> {
  const uniqueIds = [...new Set(socialAccountIds)];

  const { data, error } = await adminSupabase
    .from("social_accounts")
    .select("id")
    .eq("principal_id", principalId)
    .in("id", uniqueIds);

  if (error) {
    return {
      success: false,
      message: `Ownership check failed: ${error.message}`,
    };
  }

  return {
    success: true,
    ownedIds: new Set((data ?? []).map((row) => row.id)),
  };
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
): Promise<{ success: true } | { success: false; message: string }> {
  const platforms = [...new Set(posts.map((post) => post.platform))];
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  for (const platform of platforms) {
    const postsForPlatform = posts.filter(
      (post) => post.platform === platform,
    ).length;

    const { count: existingCount, error: countError } = await adminSupabase
      .from("scheduled_posts")
      .select("id", { count: "exact", head: true })
      .eq("principal_id", principalId)
      .eq("platform", platform)
      .gte("scheduled_at", now.toISOString())
      .lte("scheduled_at", tomorrow.toISOString());

    if (countError) {
      console.error(
        `[schedulePostBatch] Quota count failed for ${platform}:`,
        countError.message,
      );
      return { success: false, message: "Platform quota lookup failed." };
    }

    const { data: quota, error: quotaError } = await adminSupabase
      .from("platform_quotas")
      .select("daily_cap")
      .eq("platform", platform)
      .maybeSingle();

    if (quotaError) {
      console.error(
        `[schedulePostBatch] Quota fetch failed for ${platform}:`,
        quotaError.message,
      );
      return { success: false, message: "Platform quota lookup failed." };
    }

    const dailyCap = quota?.daily_cap ?? DEFAULT_PLATFORM_DAILY_CAP;
    const totalAfter = (existingCount ?? 0) + postsForPlatform;

    if (totalAfter > dailyCap) {
      return {
        success: false,
        message: `Platform quota exceeded for ${platform}. ${existingCount ?? 0} already scheduled in next 24h, adding ${postsForPlatform} would exceed daily cap of ${dailyCap}.`,
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
