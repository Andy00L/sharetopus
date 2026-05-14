import "server-only";

import { schedulePostBatch } from "@/actions/server/scheduleActions/schedule/schedulePostBatch";
import type { SchedulePostData } from "@/lib/types/SchedulePostData";
import { generateBatchId } from "@/lib/utils/generateBatchId";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withMcpTool } from "../withMcpTool";

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

type BulkScheduleArgs = {
  posts: BulkSchedulePostInput[];
  batch_id?: string;
};

/**
 * MCP tool: schedule up to 30 posts in a single bulk insert.
 *
 * Plan gate: creator+ (entitlement gate + monthly quota enforced by HOF).
 * Tables touched: scheduled_posts (bulk upsert), social_accounts (ownership),
 *                 platform_quotas (daily cap check).
 * Calls: src/actions/server/scheduleActions/schedule/schedulePostBatch.ts
 *
 * Thin wrapper: HOF runs the entitlement check + audit, this handler
 * only does shape translation and core delegation. All validation,
 * ownership, platform quota, insert, and idempotency logic lives in
 * the core.
 *
 * Idempotency: if the agent supplies batch_id, each post gets
 * idempotency_key = `${batch_id}:${index}`. Retries with the same
 * batch_id are no-ops via the partial unique index on
 * (principal_id, idempotency_key).
 *
 * Audit: the full posts array is large, so we summarize args to
 * { count } via auditArgsBuilder for deny + thrown-error paths, and
 * to { count, batch_id } via the handler-returned auditArgs on
 * success / handler-error paths.
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
    withMcpTool(
      "bulk_schedule",
      async (ctx, args: BulkScheduleArgs) => {
        // Shared batch_id for all posts in this call. Agent-supplied
        // if present, else generated server-side.
        const sharedBatchId = args.batch_id ?? generateBatchId();
        const agentSuppliedBatchId = Boolean(args.batch_id);

        // Translate MCP input shape -> SchedulePostData shape.
        const scheduledPostsData: SchedulePostData[] = args.posts.map(
          (inputPost, postIndex) => {
            const pinterestOptions =
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
              postOptions: pinterestOptions,
              batch_id: sharedBatchId,
              // Derive per-post idempotency_key from agent batch_id
              // for retry safety. If agent did not supply batch_id,
              // leave undefined and let core generate its own
              // per-row keys.
              idempotency_key: agentSuppliedBatchId
                ? `${sharedBatchId}:${postIndex}`
                : undefined,
            };
          },
        );

        const scheduleResult = await schedulePostBatch(
          scheduledPostsData,
          ctx.principal.principalId,
          "mcp",
          ctx.requestId,
        );

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
            auditArgs: {
              count: args.posts.length,
              batch_id: scheduleResult.batchId,
            },
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
          auditArgs: {
            count: args.posts.length,
            batch_id: scheduleResult.batchId,
          },
        };
      },
      {
        // Applied on deny + thrown-error paths. The handler-returned
        // auditArgs above takes precedence on success / handler-error
        // paths and includes the resolved batch_id.
        auditArgsBuilder: (args) => ({ count: args.posts.length }),
      },
    ),
  );
}
