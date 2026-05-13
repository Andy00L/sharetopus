// src/lib/mcp/tools/bulkSchedule.ts
import { schedulePostBatch } from "@/actions/server/scheduleActions/schedule/schedulePostBatch";
import {
  extractClientName,
  extractClientVersion,
  extractIpHash,
  extractPrincipal,
  extractSessionId,
  extractUserAgent,
} from "@/lib/mcp/context";
import type { SchedulePostData } from "@/lib/types/SchedulePostData";
import { generateBatchId } from "@/lib/utils/generateBatchId";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { logToolCall } from "../audit";
import { entitlementFor } from "../entitlement";

const MAX_POSTS_PER_CALL = 30;

const postSchema = z.object({
  social_account_id: z
    .string()
    .uuid()
    .describe(
      "UUID of the social account to post to. Get this from list_connections. Must be an account the calling principal owns.",
    ),
  platform: z
    .enum(["linkedin", "tiktok", "pinterest", "instagram"])
    .describe(
      "Target social media platform. Must match the platform of the provided social_account_id.",
    ),
  scheduled_at: z
    .string()
    .describe(
      "ISO 8601 datetime string for when to publish (e.g. '2026-06-01T14:30:00Z'). Must be in the future.",
    ),
  post_type: z
    .enum(["text", "image", "video"])
    .describe(
      "Type of post. Text posts only supported on LinkedIn. Pinterest/TikTok/Instagram require image or video.",
    ),
  title: z
    .string()
    .optional()
    .describe(
      "Optional post title. Used by Pinterest and YouTube. Ignored by LinkedIn/TikTok/Instagram.",
    ),
  description: z
    .string()
    .nullable()
    .describe(
      "Post body text / caption. Required for text posts. Optional but recommended for media posts.",
    ),
  media_storage_path: z
    .string()
    .optional()
    .default("")
    .describe(
      "Supabase Storage path for the media file. Required for image/video posts. Get this by calling attach_media_from_url first.",
    ),
  pinterest_board_id: z
    .string()
    .optional()
    .describe(
      "Pinterest board ID. REQUIRED when platform='pinterest'. Get available boards via list_pinterest_boards.",
    ),
  pinterest_board_name: z
    .string()
    .optional()
    .describe(
      "Optional Pinterest board display name. Cosmetic. Only valid when platform='pinterest'.",
    ),
  pinterest_link: z
    .string()
    .url()
    .max(2048)
    .optional()
    .describe(
      "Destination URL for the Pinterest pin (clickthrough). Max 2048 chars. Only valid when platform='pinterest'.",
    ),
});

type BulkSchedulePostInput = z.infer<typeof postSchema>;

/**
 * MCP tool: schedule up to 30 posts in a single bulk insert.
 *
 * Plan gate: Creator+
 * Tables touched: scheduled_posts (bulk upsert), social_accounts (ownership),
 *                 platform_quotas (daily cap check)
 * Calls: src/actions/server/scheduleActions/schedule/schedulePostBatch.ts
 *
 * Thin wrapper: entitlement check + audit log. All validation, ownership,
 * platform quota, insert, and idempotency logic lives in the core.
 *
 * Idempotency: if the agent supplies batch_id, each post gets
 * idempotency_key = `${batch_id}:${index}`. Retries with the same batch_id
 * are no-ops via the partial unique index on (principal_id, idempotency_key).
 */
export function registerBulkSchedule(server: McpServer): void {
  server.registerTool(
    "bulk_schedule",
    {
      title: "Bulk Schedule",
      description: `Schedule up to ${MAX_POSTS_PER_CALL} posts in a single call. Requires Creator plan or higher. Use this when cross-posting the same media to multiple accounts/platforms, or when scheduling a content series in one shot. For media posts, call attach_media_from_url first. For Pinterest entries, include pinterest_board_id per post. To make retries safe (recommended for agent flows), supply batch_id.`,
      inputSchema: {
        posts: z
          .array(postSchema)
          .min(1)
          .max(MAX_POSTS_PER_CALL)
          .describe(
            `Array of posts to schedule (1 to ${MAX_POSTS_PER_CALL}). Each entry represents one post = one social account + one platform. To cross-post to N accounts, include N entries with the same media_storage_path.`,
          ),
        batch_id: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe(
            "Optional batch_id to group all posts in this call. When supplied, each post gets idempotency_key = `${batch_id}:${index}`. Retries with the same batch_id are no-ops (already-scheduled posts will not be duplicated). Strongly recommended for agent retries after network errors.",
          ),
      },
      annotations: {
        title: "Bulk Schedule",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (toolArgs, extra) => {
      const principal = extractPrincipal(extra);
      const sessionId = extractSessionId(extra);
      const ipHash = await extractIpHash();
      const userAgent = await extractUserAgent();
      const clientName = extractClientName(extra);
      const clientVersion = extractClientVersion(extra);
      const startTime = Date.now();

      // Plan-tier gate (MCP-specific, separate from web's Clerk subscription).
      const entitlement = await entitlementFor(principal, "bulk_schedule");
      if (entitlement.mode === "deny") {
        await logToolCall({
          principal,
          sessionId,
          toolName: "bulk_schedule",
          args: { count: toolArgs.posts.length },
          resultStatus:
            entitlement.reason === "platform_quota"
              ? "quota_exceeded"
              : "denied",
          latencyMs: Date.now() - startTime,
          ipHash,
          userAgent,
          clientName,
          clientVersion,
        });
        return {
          content: [
            {
              type: "text",
              text: `Denied: ${entitlement.detail ?? entitlement.reason}`,
            },
          ],
          isError: true,
        };
      }

      // Shared batch_id for all posts in this call. Agent-supplied if present,
      // else generated server-side.
      const batchId = toolArgs.batch_id ?? generateBatchId();
      const agentSuppliedBatchId = Boolean(toolArgs.batch_id);

      // Translate MCP input shape -> SchedulePostData shape.
      const posts: SchedulePostData[] = toolArgs.posts.map(
        (inputPost: BulkSchedulePostInput, postIndex: number) => {
          const postOptions =
            inputPost.platform === "pinterest"
              ? {
                  privacyLevel: "PUBLIC" as const,
                  board: inputPost.pinterest_board_id ?? "",
                  link: inputPost.pinterest_link ?? "",
                }
              : null;

          return {
            socialAccountId: inputPost.social_account_id,
            platform: inputPost.platform,
            scheduledAt: inputPost.scheduled_at,
            postType: inputPost.post_type,
            title: inputPost.title ?? null,
            description: inputPost.description,
            mediaStoragePath: inputPost.media_storage_path,
            postOptions,
            batch_id: batchId,
            // Derive per-post idempotency_key from agent batch_id for retry
            // safety. If agent didn't supply batch_id, leave undefined and
            // let core generate its own per-row keys.
            idempotency_key: agentSuppliedBatchId
              ? `${batchId}:${postIndex}`
              : undefined,
          };
        },
      );

      const scheduleResult = await schedulePostBatch(
        posts,
        principal.principalId,
        "mcp",
      );

      await logToolCall({
        principal,
        sessionId,
        toolName: "bulk_schedule",
        args: {
          count: toolArgs.posts.length,
          batch_id: scheduleResult.batchId,
        },
        resultStatus: scheduleResult.success ? "ok" : "error",
        latencyMs: Date.now() - startTime,
        ipHash,
        userAgent,
        clientName,
        clientVersion,
      });

      if (!scheduleResult.success) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  batch_id: scheduleResult.batchId,
                  message: scheduleResult.message,
                  details: scheduleResult.details,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                batch_id: scheduleResult.batchId,
                total: scheduleResult.details.total,
                inserted: scheduleResult.details.inserted,
                duplicates: scheduleResult.details.duplicates,
                rejected: scheduleResult.details.rejected,
                schedule_ids: scheduleResult.scheduleIds,
                message: scheduleResult.message,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
