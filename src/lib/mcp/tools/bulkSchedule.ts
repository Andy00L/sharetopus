import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { entitlementFor } from "../entitlement";
import { logToolCall } from "../audit";
import { extractPrincipal, extractSessionId } from "@/lib/mcp/context";
import type { McpPrincipal } from "../auth";
import type { TablesInsert } from "@/lib/types/database.types";

// ---------------------------------------------------------------------------
// Constants & schema
// ---------------------------------------------------------------------------

const MAX_POSTS_PER_CALL = 30;

const postSchema = z.object({
  social_account_id: z.string().uuid(),
  platform: z.enum(["linkedin", "tiktok", "pinterest", "instagram"]),
  scheduled_at: z.string(),
  post_type: z.enum(["text", "image", "video"]),
  title: z.string().optional(),
  description: z.string().nullable(),
  media_storage_path: z.string().optional().default(""),
});

type PostInput = z.infer<typeof postSchema>;

// ---------------------------------------------------------------------------
// Result types
//
// Match the codebase convention: success boolean + message + optional payload.
// Internal helpers use these so the handler can branch on `result.success`
// without ever seeing a raw supabase error tuple.
// ---------------------------------------------------------------------------

type EntitlementCheckResult =
  | { success: true }
  | {
      success: false;
      message: string;
      auditStatus: "denied" | "quota_exceeded";
    };

type PlatformQuotaCheckResult =
  | { success: true }
  | {
      success: false;
      message: string;
      auditStatus: "quota_exceeded";
    };

type AccountOwnershipCheckResult =
  | { success: true }
  | {
      success: false;
      message: string;
      auditStatus: "denied" | "error";
      unownedIds?: string[];
    };

type ScheduledPostInsertRow = TablesInsert<"scheduled_posts">;

type BulkInsertResult =
  | {
      success: true;
      insertedIds: string[];
      skippedIdempotentIndexes: number[];
    }
  | {
      success: false;
      message: string;
      pgErrorCode: string | null;
    };

type PerPostResult = {
  index: number;
  success: boolean;
  message: string;
  scheduleId?: string;
};

type BulkScheduleContext = {
  principal: McpPrincipal;
  sessionId: string | null;
  startedAt: number;
};

type McpToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/** Wraps extractPrincipal + extractSessionId + Date.now(). */
function buildBulkScheduleContext(
  extra: Record<string, unknown>
): BulkScheduleContext {
  return {
    principal: extractPrincipal(extra),
    sessionId: extractSessionId(extra),
    startedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Preflight helpers
// ---------------------------------------------------------------------------

/**
 * Checks whether the principal's plan allows bulk_schedule.
 * Returns a deny result with an appropriate audit status on failure.
 */
async function checkBulkScheduleEntitlement(
  ctx: BulkScheduleContext
): Promise<EntitlementCheckResult> {
  try {
    const ent = await entitlementFor(ctx.principal, "bulk_schedule");
    if (ent.mode === "deny") {
      console.error(
        `[checkBulkScheduleEntitlement] denied for ${ctx.principal.principalId}:`,
        ent.reason,
        ent.detail
      );
      return {
        success: false,
        message: `Denied: ${ent.detail ?? ent.reason}`,
        auditStatus:
          ent.reason === "platform_quota" ? "quota_exceeded" : "denied",
      };
    }
    return { success: true };
  } catch (err) {
    console.error("[checkBulkScheduleEntitlement] unexpected:", err);
    return {
      success: false,
      message: "Entitlement check failed unexpectedly.",
      auditStatus: "denied",
    };
  }
}

/**
 * Checks per-platform daily caps for the next 24 hours.
 * Fails on the first platform that would exceed its cap.
 * Absorbs supabase errors into the result.
 */
async function enforcePlatformDailyQuotas(
  ctx: BulkScheduleContext,
  posts: PostInput[]
): Promise<PlatformQuotaCheckResult> {
  const platforms = [...new Set(posts.map((p) => p.platform))];
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  for (const platform of platforms) {
    try {
      const postsForPlatform = posts.filter(
        (p) => p.platform === platform
      ).length;

      const { count: existingCount, error: countError } = await adminSupabase
        .from("scheduled_posts")
        .select("id", { count: "exact", head: true })
        .eq("principal_id", ctx.principal.principalId)
        .eq("platform", platform)
        .gte("scheduled_at", now.toISOString())
        .lte("scheduled_at", tomorrow.toISOString());

      if (countError) {
        console.error(
          `[enforcePlatformDailyQuotas] count query failed for ${platform}:`,
          countError
        );
        return {
          success: false,
          message: "Platform quota lookup failed.",
          auditStatus: "quota_exceeded",
        };
      }

      const { data: quota, error: quotaError } = await adminSupabase
        .from("platform_quotas")
        .select("daily_cap")
        .eq("platform", platform)
        .maybeSingle();

      if (quotaError) {
        console.error(
          `[enforcePlatformDailyQuotas] quota fetch failed for ${platform}:`,
          quotaError
        );
        return {
          success: false,
          message: "Platform quota lookup failed.",
          auditStatus: "quota_exceeded",
        };
      }

      const dailyCap = quota?.daily_cap ?? 50;
      const totalAfter = (existingCount ?? 0) + postsForPlatform;

      if (totalAfter > dailyCap) {
        console.error(
          `[enforcePlatformDailyQuotas] ${platform}: ` +
            `${existingCount ?? 0} existing + ${postsForPlatform} new > cap ${dailyCap}`
        );
        return {
          success: false,
          message:
            `Platform quota exceeded for ${platform}. ` +
            `${existingCount ?? 0} posts already scheduled in the next 24h, ` +
            `adding ${postsForPlatform} would exceed the daily cap of ${dailyCap}.`,
          auditStatus: "quota_exceeded",
        };
      }
    } catch (err) {
      console.error(
        `[enforcePlatformDailyQuotas] unexpected error for ${platform}:`,
        err
      );
      return {
        success: false,
        message: "Platform quota lookup failed.",
        auditStatus: "quota_exceeded",
      };
    }
  }

  return { success: true };
}

/**
 * Verifies the principal owns every social_account_id in the batch.
 * One bulk SELECT, no per-account queries.
 * Absorbs supabase errors and unowned-account denials into the result.
 */
async function verifyAccountOwnership(
  ctx: BulkScheduleContext,
  posts: PostInput[]
): Promise<AccountOwnershipCheckResult> {
  const accountIds = [...new Set(posts.map((p) => p.social_account_id))];

  try {
    const { data: ownedAccounts, error } = await adminSupabase
      .from("social_accounts")
      .select("id")
      .eq("principal_id", ctx.principal.principalId)
      .in("id", accountIds);

    if (error) {
      console.error("[verifyAccountOwnership] supabase error:", error);
      return {
        success: false,
        message: "Failed to verify social account ownership.",
        auditStatus: "error",
      };
    }

    const ownedIds = new Set((ownedAccounts ?? []).map((a) => a.id));
    const unownedIds = accountIds.filter((id) => !ownedIds.has(id));

    if (unownedIds.length > 0) {
      console.warn("[verifyAccountOwnership] unowned accounts:", unownedIds);
      return {
        success: false,
        message: `You do not own the following social account(s): ${unownedIds.join(", ")}`,
        auditStatus: "denied",
        unownedIds,
      };
    }

    return { success: true };
  } catch (err) {
    console.error("[verifyAccountOwnership] unexpected:", err);
    return {
      success: false,
      message: "Failed to verify social account ownership.",
      auditStatus: "error",
    };
  }
}

// ---------------------------------------------------------------------------
// Insert helpers
// ---------------------------------------------------------------------------

/**
 * Builds the insert row array. Pure; no DB calls or side effects.
 * Every row gets an idempotency_key of `${batchId}:${index}`.
 */
function buildScheduledPostRows(
  posts: PostInput[],
  principalId: string,
  batchId: string
): ScheduledPostInsertRow[] {
  return posts.map((post, i) => ({
    principal_id: principalId,
    social_account_id: post.social_account_id,
    platform: post.platform,
    status: "scheduled" as const,
    scheduled_at: new Date(post.scheduled_at).toISOString(),
    post_title: post.title ?? "",
    post_description: post.description,
    post_options: null,
    media_type: post.post_type,
    media_storage_path: post.media_storage_path,
    cover_image_timestamp: null,
    batch_id: batchId,
    created_via: "mcp" as const,
    idempotency_key: `${batchId}:${i}`,
  }));
}

/**
 * Idempotent bulk insert using ON CONFLICT DO NOTHING on the partial
 * unique index (principal_id, idempotency_key).
 *
 * Returns inserted IDs in input order, plus which indexes were
 * idempotent skips (already existed from a prior call with the same
 * batch_id).
 */
async function insertScheduledPostsIdempotent(
  rows: ScheduledPostInsertRow[]
): Promise<BulkInsertResult> {
  try {
    const { data: inserted, error } = await adminSupabase
      .from("scheduled_posts")
      .upsert(rows, {
        onConflict: "principal_id,idempotency_key",
        ignoreDuplicates: true,
      })
      .select("id, idempotency_key");

    if (error) {
      console.error("[insertScheduledPostsIdempotent] supabase error:", error);
      return {
        success: false,
        message: `Bulk insert failed: ${error.message}`,
        pgErrorCode: error.code ?? null,
      };
    }

    const insertedRows = inserted ?? [];
    const insertedKeySet = new Set(
      insertedRows.map((r) => r.idempotency_key)
    );

    const allKeys = rows
      .map((r) => r.idempotency_key)
      .filter((k): k is string => k != null);
    const skippedKeys = allKeys.filter((k) => !insertedKeySet.has(k));

    const keyToId = new Map<string, string>();
    for (const r of insertedRows) {
      if (r.idempotency_key) {
        keyToId.set(r.idempotency_key, r.id);
      }
    }

    if (skippedKeys.length > 0) {
      const { data: existing, error: fetchErr } = await adminSupabase
        .from("scheduled_posts")
        .select("id, idempotency_key")
        .eq("principal_id", rows[0].principal_id)
        .in("idempotency_key", skippedKeys);

      if (fetchErr) {
        console.error(
          "[insertScheduledPostsIdempotent] fetch existing error:",
          fetchErr
        );
        return {
          success: false,
          message: `Inserted some posts but failed to look up previously scheduled duplicates: ${fetchErr.message}`,
          pgErrorCode: fetchErr.code ?? null,
        };
      }

      for (const r of existing ?? []) {
        if (r.idempotency_key) {
          keyToId.set(r.idempotency_key, r.id);
        }
      }
    }

    const insertedIds: string[] = [];
    const skippedIdempotentIndexes: number[] = [];
    const skippedKeySet = new Set(skippedKeys);

    for (let i = 0; i < rows.length; i++) {
      const key = rows[i].idempotency_key;
      insertedIds.push(key ? (keyToId.get(key) ?? "") : "");
      if (key && skippedKeySet.has(key)) {
        skippedIdempotentIndexes.push(i);
      }
    }

    return { success: true, insertedIds, skippedIdempotentIndexes };
  } catch (unexpected) {
    console.error("[insertScheduledPostsIdempotent] unexpected:", unexpected);
    return {
      success: false,
      message:
        "Bulk insert failed unexpectedly. None of the posts were scheduled.",
      pgErrorCode: null,
    };
  }
}

/**
 * Transforms a successful BulkInsertResult into per-post results.
 * Pure; only called when insertResult.success is true.
 */
function buildPerPostResults(
  posts: PostInput[],
  _batchId: string,
  insertResult: {
    success: true;
    insertedIds: string[];
    skippedIdempotentIndexes: number[];
  }
): PerPostResult[] {
  const skippedSet = new Set(insertResult.skippedIdempotentIndexes);
  return posts.map((_, i) => ({
    index: i,
    success: true,
    message: skippedSet.has(i)
      ? "Already scheduled (idempotent retry)."
      : "Scheduled.",
    scheduleId: insertResult.insertedIds[i],
  }));
}

// ---------------------------------------------------------------------------
// Audit helpers
// ---------------------------------------------------------------------------

/** Records the final audit entry after insert (success or failure). */
async function recordBulkScheduleAudit(
  ctx: BulkScheduleContext,
  batchId: string,
  totalCount: number,
  insertResult: BulkInsertResult
): Promise<void> {
  try {
    await logToolCall({
      principal: ctx.principal,
      sessionId: ctx.sessionId,
      toolName: "bulk_schedule",
      args: {
        count: totalCount,
        batch_id: batchId,
        ...(insertResult.success === false
          ? { pg_error_code: insertResult.pgErrorCode }
          : {}),
      },
      resultStatus: insertResult.success ? "ok" : "error",
      latencyMs: Date.now() - ctx.startedAt,
    });
  } catch (err) {
    console.error("[recordBulkScheduleAudit] unexpected:", err);
  }
}

/** Records an audit entry when a preflight check denies the request. */
async function recordPreflightDeny(
  ctx: BulkScheduleContext,
  denyResult: { auditStatus: "denied" | "quota_exceeded" | "error" },
  totalCount: number
): Promise<void> {
  try {
    await logToolCall({
      principal: ctx.principal,
      sessionId: ctx.sessionId,
      toolName: "bulk_schedule",
      args: { count: totalCount },
      resultStatus: denyResult.auditStatus,
      latencyMs: Date.now() - ctx.startedAt,
    });
  } catch (err) {
    console.error("[recordPreflightDeny] unexpected:", err);
  }
}

// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------

function buildDenyResponse(message: string): McpToolResponse {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function buildSuccessResponse(
  batchId: string,
  totalCount: number,
  results: PerPostResult[]
): McpToolResponse {
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            batch_id: batchId,
            total: totalCount,
            succeeded,
            failed,
            results,
          },
          null,
          2
        ),
      },
    ],
    isError: false,
  };
}

function buildInsertFailureResponse(
  batchId: string,
  totalCount: number,
  failureResult: { success: false; message: string }
): McpToolResponse {
  return {
    content: [
      {
        type: "text",
        text:
          `Bulk insert failed for batch ${batchId}: ${failureResult.message}. ` +
          `None of the ${totalCount} posts were scheduled. Safe to retry the ` +
          `same batch_id; already-scheduled posts will not be duplicated.`,
      },
    ],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Schedules up to 30 posts in a single call via one bulk insert.
 *
 * Plan gate: Creator+
 * Tables touched: scheduled_posts (bulk upsert), social_accounts (ownership),
 *                 platform_quotas (daily cap check)
 *
 * Pre-flight checks (all via named helpers, errors-as-values):
 *   1. Entitlement: plan tier gate.
 *   2. Platform daily quota: counts scheduled_posts in the next 24h for each
 *      (principal, platform) pair against platform_quotas.daily_cap.
 *   3. Social account ownership: one query for all unique account IDs.
 *
 * Idempotency: each row gets idempotency_key = `${batchId}:${index}`.
 * Retries with the same batch_id are no-ops at the DB layer via the
 * partial unique index idx_scheduled_posts_idempotency.
 */
export function registerBulkSchedule(server: McpServer): void {
  server.tool(
    "bulk_schedule",
    `Schedule up to ${MAX_POSTS_PER_CALL} posts at once. Requires Creator plan or higher.`,
    {
      posts: z
        .array(postSchema)
        .min(1)
        .max(MAX_POSTS_PER_CALL)
        .describe(`Array of posts to schedule (max ${MAX_POSTS_PER_CALL})`),
      batch_id: z
        .string()
        .optional()
        .describe("Optional batch ID to group all posts in this call"),
    },
    async (args, extra) => {
      const ctx = buildBulkScheduleContext(extra);

      const entitlement = await checkBulkScheduleEntitlement(ctx);
      if (entitlement.success === false) {
        await recordPreflightDeny(ctx, entitlement, args.posts.length);
        return buildDenyResponse(entitlement.message);
      }

      const platformQuota = await enforcePlatformDailyQuotas(ctx, args.posts);
      if (platformQuota.success === false) {
        await recordPreflightDeny(ctx, platformQuota, args.posts.length);
        return buildDenyResponse(platformQuota.message);
      }

      const ownership = await verifyAccountOwnership(ctx, args.posts);
      if (ownership.success === false) {
        await recordPreflightDeny(ctx, ownership, args.posts.length);
        return buildDenyResponse(ownership.message);
      }

      const batchId = args.batch_id ?? crypto.randomUUID();
      const rows = buildScheduledPostRows(
        args.posts,
        ctx.principal.principalId,
        batchId
      );
      const insertOutcome = await insertScheduledPostsIdempotent(rows);

      await recordBulkScheduleAudit(
        ctx,
        batchId,
        args.posts.length,
        insertOutcome
      );

      if (insertOutcome.success === false) {
        return buildInsertFailureResponse(
          batchId,
          args.posts.length,
          insertOutcome
        );
      }

      const results = buildPerPostResults(args.posts, batchId, insertOutcome);
      return buildSuccessResponse(batchId, args.posts.length, results);
    }
  );
}
