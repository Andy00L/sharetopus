import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { getServerSignedViewUrl } from "@/actions/server/data/getServerSignedViewUrl";
import { dispatchPostNowEvents } from "@/inngest/dispatch/dispatchPostNowEvents";
import { buildProxiedTikTokMediaUrl } from "@/lib/api/tiktok/buildProxiedTikTokMediaUrl";
import {
  CAPTION_LIMITS,
  type CaptionPlatform,
} from "@/components/core/create/constants/captionLimits";
import type { PlatformOptions } from "@/lib/types/dbTypes";
import type { PostNowEventData } from "@/inngest/functions/processDirectPostHelpers";
import { entitlementFor } from "../entitlement";
import { logToolCall } from "../audit";
import {
  extractPrincipal,
  extractSessionId,
  extractIpHash,
  extractUserAgent,
  extractClientName,
  extractClientVersion,
} from "@/lib/mcp/context";
import type { McpPrincipal } from "../auth";
import { randomUUID } from "crypto";
import { generateBatchId } from "@/lib/utils/generateBatchId";

// ---------------------------------------------------------------------------
// Constants & schema
// ---------------------------------------------------------------------------

const MAX_POSTS_PER_CALL = 30;

const postNowItemSchema = z.object({
  social_account_id: z.string().uuid(),
  platform: z.enum(["linkedin", "tiktok", "pinterest", "instagram"]),
  post_type: z.enum(["text", "image", "video"]),
  title: z.string().optional(),
  description: z.string().nullable(),
  media_storage_path: z.string().optional().default(""),
  cover_timestamp: z.number().int().min(1000).optional(),
  pinterest_board_id: z.string().optional(),
  pinterest_board_name: z.string().optional(),
  pinterest_link: z.string().url().max(2048).optional(),
});

type PostInput = z.infer<typeof postNowItemSchema>;

// ---------------------------------------------------------------------------
// Result types
//
// Match the codebase convention: success boolean + message + optional payload.
// Internal helpers use these so the handler can branch on `result.success`
// without ever seeing a raw supabase error tuple.
// ---------------------------------------------------------------------------

type McpToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
};

type Ctx = {
  principal: McpPrincipal;
  sessionId: string | null;
  ipHash: string | null;
  userAgent: string | null;
  clientName: string | null;
  clientVersion: string | null;
  startedAt: number;
};

type PinterestFieldsCheckResult =
  | { success: true }
  | {
      success: false;
      message: string;
      auditStatus: "denied";
      invalidIndexes: number[];
    };

type CaptionCheckResult =
  | { success: true }
  | {
      success: false;
      message: string;
      auditStatus: "denied";
      invalidIndexes: number[];
    };

type MediaCheckResult =
  | { success: true }
  | {
      success: false;
      message: string;
      auditStatus: "denied";
      invalidIndexes: number[];
    };

type OwnershipCheckResult =
  | { success: true }
  | {
      success: false;
      message: string;
      auditStatus: "denied" | "error";
    };

type UrlBuildResult =
  | {
      success: true;
      signedByPath: Map<string, string>;
      tiktokByPath: Map<string, string>;
    }
  | {
      success: false;
      message: string;
      auditStatus: "error";
    };

// ---------------------------------------------------------------------------
// Preflight helpers
// ---------------------------------------------------------------------------

/**
 * Validates Pinterest-specific fields per post:
 *   - pinterest_board_id is required when platform = 'pinterest'
 *   - pinterest_* fields are only valid when platform = 'pinterest'
 *
 * Mirrors validatePinterestFieldsPerPost in bulkSchedule.ts (not exported
 * there, so defined locally with the same logic).
 */
function validatePinterestFieldsPerPostNowItem(
  posts: PostInput[]
): PinterestFieldsCheckResult {
  const invalidIndexes: number[] = [];
  const reasons: string[] = [];

  posts.forEach((post, i) => {
    const hasPinterestField =
      Boolean(post.pinterest_board_id) ||
      Boolean(post.pinterest_board_name) ||
      Boolean(post.pinterest_link);

    if (post.platform === "pinterest" && !post.pinterest_board_id) {
      invalidIndexes.push(i);
      reasons.push(
        `Post #${i}: pinterest_board_id is required for Pinterest.`
      );
      return;
    }
    if (post.platform !== "pinterest" && hasPinterestField) {
      invalidIndexes.push(i);
      reasons.push(
        `Post #${i}: pinterest_* fields are only valid when platform = 'pinterest'.`
      );
    }
  });

  if (invalidIndexes.length > 0) {
    return {
      success: false,
      message: reasons.join(" "),
      auditStatus: "denied",
      invalidIndexes,
    };
  }
  return { success: true };
}

/**
 * Validates caption lengths per post against per-platform limits.
 * Mirrors the per-post caption check in postNow.ts, but batched.
 */
function validateCaptionLengthsPerPost(
  posts: PostInput[]
): CaptionCheckResult {
  const invalidIndexes: number[] = [];
  const reasons: string[] = [];

  posts.forEach((post, i) => {
    if (!post.description) return;
    const limit =
      CAPTION_LIMITS[post.platform as CaptionPlatform] ??
      CAPTION_LIMITS.default;
    if (post.description.length > limit) {
      invalidIndexes.push(i);
      reasons.push(
        `Post #${i}: caption exceeds ${post.platform} limit of ${limit} chars (got ${post.description.length}).`
      );
    }
  });

  if (invalidIndexes.length > 0) {
    return {
      success: false,
      message: reasons.join(" "),
      auditStatus: "denied",
      invalidIndexes,
    };
  }
  return { success: true };
}

/**
 * Validates that image/video posts have a media_storage_path.
 * Mirrors the media-required check in postNow.ts, but batched.
 */
function validateMediaPresence(posts: PostInput[]): MediaCheckResult {
  const invalidIndexes: number[] = [];
  const reasons: string[] = [];

  posts.forEach((post, i) => {
    if (
      (post.post_type === "image" || post.post_type === "video") &&
      !post.media_storage_path
    ) {
      invalidIndexes.push(i);
      reasons.push(
        `Post #${i}: media_storage_path is required for ${post.post_type} posts.`
      );
    }
  });

  if (invalidIndexes.length > 0) {
    return {
      success: false,
      message: reasons.join(" "),
      auditStatus: "denied",
      invalidIndexes,
    };
  }
  return { success: true };
}

// ---------------------------------------------------------------------------
// Ownership + platform match
// ---------------------------------------------------------------------------

/**
 * Verifies the principal owns every social_account_id in the batch and
 * that each account's platform matches the post's declared platform.
 * One bulk SELECT, no per-account queries.
 */
async function verifyOwnershipAndPlatformMatch(
  ctx: Ctx,
  posts: PostInput[]
): Promise<OwnershipCheckResult> {
  const accountIds = [...new Set(posts.map((p) => p.social_account_id))];

  try {
    const { data: ownedAccounts, error } = await adminSupabase
      .from("social_accounts")
      .select("id, platform")
      .eq("principal_id", ctx.principal.principalId)
      .is("deleted_at", null)
      .in("id", accountIds);

    if (error) {
      console.error(
        "[verifyOwnershipAndPlatformMatch] supabase error:",
        error.message
      );
      return {
        success: false,
        message: "Failed to verify social account ownership.",
        auditStatus: "error",
      };
    }

    const accountsById = new Map<string, { id: string; platform: string }>();
    for (const a of ownedAccounts ?? []) {
      accountsById.set(a.id, a);
    }

    const unowned: string[] = [];
    const platformMismatch: {
      index: number;
      expected: string;
      got: string;
    }[] = [];

    posts.forEach((post, i) => {
      const account = accountsById.get(post.social_account_id);
      if (!account) {
        unowned.push(post.social_account_id);
        return;
      }
      if (account.platform !== post.platform) {
        platformMismatch.push({
          index: i,
          expected: post.platform,
          got: account.platform,
        });
      }
    });

    if (unowned.length > 0) {
      console.warn(
        "[verifyOwnershipAndPlatformMatch] unowned accounts:",
        unowned
      );
      return {
        success: false,
        message: `You do not own the following social account(s): ${unowned.join(", ")}`,
        auditStatus: "denied",
      };
    }

    if (platformMismatch.length > 0) {
      const detail = platformMismatch
        .map(
          (m) =>
            `Post #${m.index}: requested platform "${m.expected}" but account is "${m.got}"`
        )
        .join(". ");
      return {
        success: false,
        message: `Account platform mismatch. ${detail}`,
        auditStatus: "denied",
      };
    }

    return { success: true };
  } catch (err) {
    console.error("[verifyOwnershipAndPlatformMatch] unexpected:", err);
    return {
      success: false,
      message: "Failed to verify social account ownership.",
      auditStatus: "error",
    };
  }
}

// ---------------------------------------------------------------------------
// URL builder with cache
// ---------------------------------------------------------------------------

/**
 * Mints signed URLs (non-TikTok) and proxied TikTok URLs, cached by
 * media_storage_path. If 4 events share the same path, 1 signed URL call.
 * Mirrors the URL-minting in dispatchDirectPostEvents (web path).
 */
async function buildMediaUrls(
  ctx: Ctx,
  posts: PostInput[]
): Promise<UrlBuildResult> {
  const signedByPath = new Map<string, string>();
  const tiktokByPath = new Map<string, string>();

  const signedPaths = new Set<string>();
  const tiktokPaths = new Set<string>();

  for (const post of posts) {
    if (!post.media_storage_path) continue;
    if (post.platform === "tiktok") {
      tiktokPaths.add(post.media_storage_path);
    } else {
      signedPaths.add(post.media_storage_path);
    }
  }

  for (const path of signedPaths) {
    const result = await getServerSignedViewUrl(path);
    if (!result.success) {
      console.error(
        `[buildMediaUrls] Signed URL failed for ${path}:`,
        result.message
      );
      return {
        success: false,
        message: `Failed to mint signed URL: ${result.message}`,
        auditStatus: "error",
      };
    }
    signedByPath.set(path, result.url);
  }

  for (const path of tiktokPaths) {
    const result = buildProxiedTikTokMediaUrl({
      mediaPath: path,
      principalId: ctx.principal.principalId,
    });
    if (!result.success) {
      console.error(
        `[buildMediaUrls] TikTok proxy URL failed for ${path}:`,
        result.message
      );
      return {
        success: false,
        message: `Failed to build TikTok URL: ${result.message}`,
        auditStatus: "error",
      };
    }
    tiktokByPath.set(path, result.url);
  }

  return { success: true, signedByPath, tiktokByPath };
}

// ---------------------------------------------------------------------------
// Event payload builder
// ---------------------------------------------------------------------------

/**
 * Pure function: builds one Inngest event per post. Each event matches the
 * PostNowEventData shape consumed by processDirectPost worker.
 */
function buildEventPayloads(
  posts: PostInput[],
  batchId: string,
  signedByPath: Map<string, string>,
  tiktokByPath: Map<string, string>,
  principalId: string,
  agentSuppliedBatchId: boolean
): { name: "post.now"; data: PostNowEventData }[] {
  return posts.map((post, index) => {
    const fileName = post.media_storage_path
      ? post.media_storage_path.split("/").pop() ?? ""
      : "";
    const mediaType = deriveMediaType(fileName, post.post_type);

    const platformOptions: PlatformOptions = {
      tiktok: {
        privacyLevel: "PUBLIC_TO_EVERYONE",
        disableComment: false,
        disableDuet: false,
        disableStitch: false,
      },
      pinterest: {
        privacyLevel: "PUBLIC",
        board: post.pinterest_board_id ?? "",
        link: post.pinterest_link ?? "",
      },
      linkedin: {
        visibility: "PUBLIC",
      },
    };

    const board: PostNowEventData["board"] =
      post.platform === "pinterest"
        ? {
            boardID: post.pinterest_board_id ?? "",
            boardName: post.pinterest_board_name ?? "Board",
            accountId: post.social_account_id,
            isSelected: true,
          }
        : null;

    const mediaUrl =
      post.platform !== "tiktok" && post.media_storage_path
        ? (signedByPath.get(post.media_storage_path) ?? null)
        : null;
    const tiktokMediaUrl =
      post.platform === "tiktok" && post.media_storage_path
        ? (tiktokByPath.get(post.media_storage_path) ?? null)
        : null;

    const data: PostNowEventData = {
      batch_id: batchId,
      principal_id: principalId,
      social_account_id: post.social_account_id,
      platform: post.platform,
      post_type: post.post_type,
      account_content: {
        accountId: post.social_account_id,
        title: post.title ?? "",
        description: post.description ?? "",
        link: post.pinterest_link ?? "",
        isCustomized: true,
      },
      platform_options: platformOptions,
      board,
      cover_timestamp: post.cover_timestamp ?? 1000,
      file_name: fileName,
      media_type: mediaType,
      media_path: post.media_storage_path,
      media_url: mediaUrl,
      tiktok_media_url: tiktokMediaUrl,
      dispatch_id: randomUUID(),
      created_via: "mcp",
      idempotency_key: agentSuppliedBatchId
        ? `${batchId}:${index}`
        : undefined,
    };

    return { name: "post.now" as const, data };
  });
}

/** Derives MIME type from file extension + post type. Copied from postNow.ts. */
function deriveMediaType(
  fileName: string,
  postType: "text" | "image" | "video"
): string {
  if (postType === "text") return "";
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (postType === "image") {
    if (ext === "png") return "image/png";
    if (ext === "webp") return "image/webp";
    if (ext === "gif") return "image/gif";
    return "image/jpeg";
  }
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  return "video/mp4";
}

// ---------------------------------------------------------------------------
// Audit helpers
// ---------------------------------------------------------------------------

async function recordPreflightDeny(
  ctx: Ctx,
  denyResult: { auditStatus: "denied" | "quota_exceeded" | "error" },
  totalCount: number
): Promise<void> {
  try {
    await logToolCall({
      principal: ctx.principal,
      sessionId: ctx.sessionId,
      toolName: "bulk_post_now",
      args: { count: totalCount },
      resultStatus: denyResult.auditStatus,
      latencyMs: Date.now() - ctx.startedAt,
      ipHash: ctx.ipHash,
      userAgent: ctx.userAgent,
      clientName: ctx.clientName,
      clientVersion: ctx.clientVersion,
    });
  } catch (err) {
    console.error("[recordPreflightDeny] unexpected:", err);
  }
}

async function recordSuccess(
  ctx: Ctx,
  batchId: string,
  totalCount: number
): Promise<void> {
  try {
    await logToolCall({
      principal: ctx.principal,
      sessionId: ctx.sessionId,
      toolName: "bulk_post_now",
      args: { count: totalCount, batch_id: batchId },
      resultStatus: "ok",
      latencyMs: Date.now() - ctx.startedAt,
      ipHash: ctx.ipHash,
      userAgent: ctx.userAgent,
      clientName: ctx.clientName,
      clientVersion: ctx.clientVersion,
    });
  } catch (err) {
    console.error("[recordSuccess] unexpected:", err);
  }
}

// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------

function buildDenyResponse(message: string): McpToolResponse {
  return { content: [{ type: "text", text: message }], isError: true };
}

function buildSuccessResponse(
  batchId: string,
  posts: PostInput[],
  eventIds: string[],
  freshCount: number
): McpToolResponse {
  const results = posts.map((post, i) => ({
    index: i,
    platform: post.platform,
    social_account_id: post.social_account_id,
    event_id: eventIds[i] ?? null,
  }));

  const isIdempotentRetry = freshCount < posts.length;

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            success: true,
            batch_id: batchId,
            dispatched: freshCount,
            total: posts.length,
            results,
            message: isIdempotentRetry
              ? `${freshCount} new post(s) dispatched, ${posts.length - freshCount} already existed (idempotent retry). Check list_content_history in 30-60s.`
              : "All posts dispatched. Check list_content_history in 30-60s. " +
                "TikTok posts may take up to 2 minutes (async pull).",
          },
          null,
          2
        ),
      },
    ],
    isError: false,
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Publishes up to 30 posts immediately across multiple platforms and
 * accounts. Mirrors the web direct-post path (handleSocialMediaPost ->
 * dispatchDirectPostEvents) but via MCP.
 *
 * Plan gate: Creator+ (same as bulk_schedule).
 * Monthly cap: 500 creator / unlimited pro.
 *
 * Tables touched:
 *   social_accounts (read, ownership + platform check)
 *   pending_direct_posts (insert, lock rows)
 * Inngest events sent:
 *   post.now (consumed by processDirectPost worker, one per post)
 *
 * Key design choice: all N pending_direct_posts locks are inserted before
 * any events are dispatched. This means cleanupMediaIfUnreferenced (called
 * by the worker when a post completes) sees the lock count and only deletes
 * the media file when the LAST worker finalizes. This fixes the MCP gap
 * where sequential post_now calls with the same media_storage_path failed
 * because the first call's worker cleaned up the file.
 */
export function registerBulkPostNow(server: McpServer): void {
  server.registerTool(
    "bulk_post_now",
    {
      title: "Bulk Post Now",
      description:
        `Publish up to ${MAX_POSTS_PER_CALL} posts immediately across multiple platforms and accounts. ` +
        "Requires Creator plan or higher. Reuses one media upload across N posts " +
        "(one entry in the array = one platform+account combo). For Pinterest entries, " +
        "include pinterest_board_id. Returns event IDs; check list_content_history in 30-60s to confirm.",
      inputSchema: {
        posts: z
          .array(postNowItemSchema)
          .min(1)
          .max(MAX_POSTS_PER_CALL)
          .describe(
            `Array of posts to publish immediately (max ${MAX_POSTS_PER_CALL}). Each entry = one platform + one social account.`
          ),
        batch_id: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe(
            "Optional batch ID. When supplied, each post gets idempotency_key = `${batch_id}:${index}`, making retries safe. Without it, retries may create duplicates."
          ),
      },
      annotations: {
        title: "Bulk Post Now",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args, extra) => {
      const ctx: Ctx = {
        principal: extractPrincipal(extra),
        sessionId: extractSessionId(extra),
        ipHash: await extractIpHash(),
        userAgent: await extractUserAgent(),
        clientName: extractClientName(extra),
        clientVersion: extractClientVersion(extra),
        startedAt: Date.now(),
      };

      // 1. Entitlement
      const ent = await entitlementFor(ctx.principal, "bulk_post_now");
      if (ent.mode === "deny") {
        await recordPreflightDeny(
          ctx,
          {
            auditStatus:
              ent.reason === "platform_quota" ||
              ent.reason === "monthly_quota"
                ? "quota_exceeded"
                : "denied",
          },
          args.posts.length
        );
        return buildDenyResponse(`Denied: ${ent.detail ?? ent.reason}`);
      }

      // 2. Pinterest validation
      const pinterestCheck = validatePinterestFieldsPerPostNowItem(args.posts);
      if (pinterestCheck.success === false) {
        await recordPreflightDeny(ctx, pinterestCheck, args.posts.length);
        return buildDenyResponse(pinterestCheck.message);
      }

      // 3. Caption length validation
      const captionCheck = validateCaptionLengthsPerPost(args.posts);
      if (captionCheck.success === false) {
        await recordPreflightDeny(ctx, captionCheck, args.posts.length);
        return buildDenyResponse(captionCheck.message);
      }

      // 4. Media presence validation
      const mediaCheck = validateMediaPresence(args.posts);
      if (mediaCheck.success === false) {
        await recordPreflightDeny(ctx, mediaCheck, args.posts.length);
        return buildDenyResponse(mediaCheck.message);
      }

      // 5. Ownership + platform-match
      const ownership = await verifyOwnershipAndPlatformMatch(ctx, args.posts);
      if (ownership.success === false) {
        await recordPreflightDeny(ctx, ownership, args.posts.length);
        return buildDenyResponse(ownership.message);
      }

      // 6. Mint URLs (cached by path)
      const urls = await buildMediaUrls(ctx, args.posts);
      if (urls.success === false) {
        await recordPreflightDeny(ctx, urls, args.posts.length);
        return buildDenyResponse(urls.message);
      }

      // 7. Build event payloads (pure)
      const agentSuppliedBatchId = Boolean(args.batch_id);
      const batchId = args.batch_id ?? generateBatchId();
      const events = buildEventPayloads(
        args.posts,
        batchId,
        urls.signedByPath,
        urls.tiktokByPath,
        ctx.principal.principalId,
        agentSuppliedBatchId
      );

      // 8. Insert locks + dispatch
      const dispatch = await dispatchPostNowEvents(events);
      if (!dispatch.success) {
        await recordPreflightDeny(
          ctx,
          { auditStatus: "error" },
          args.posts.length
        );
        return buildDenyResponse(dispatch.message);
      }

      // 9. Audit success and return
      await recordSuccess(ctx, batchId, args.posts.length);
      return buildSuccessResponse(
        batchId,
        args.posts,
        dispatch.eventIds,
        dispatch.freshCount
      );
    }
  );
}
