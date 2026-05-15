import "server-only";

import type { DirectPostData } from "@/actions/server/directPostActions/directPostBatch";
import { directPostBatch } from "@/actions/server/directPostActions/directPostBatch";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import { withMcpTool } from "../withMcpTool";

const MAX_POSTS_PER_CALL = 30;

const postNowItemSchema = z.object({
  social_account_id: z.string().uuid().describe("UUID of the social account"),
  platform: z
    .enum(["linkedin", "tiktok", "pinterest", "instagram"])
    .describe("Target platform"),
  post_type: z.enum(["text", "image", "video"]).describe("Type of post"),
  title: z.string().optional().describe("Post title (used by some platforms)"),
  description: z.string().nullable().describe("Post body text / caption"),
  media_storage_path: z
    .string()
    .optional()
    .default("")
    .describe("Supabase Storage path. Required for image/video."),
  cover_timestamp: z
    .number()
    .int()
    .min(1000)
    .optional()
    .describe("TikTok video cover frame at this ms mark (>=1000)"),
  pinterest_board_id: z
    .string()
    .optional()
    .describe("Pinterest board ID. Required when platform='pinterest'."),
  pinterest_board_name: z
    .string()
    .optional()
    .describe("Pinterest board display name. Optional."),
  pinterest_link: z
    .string()
    .url()
    .max(2048)
    .optional()
    .describe("Pinterest pin destination URL. Max 2048 chars."),
});

type BulkPostNowItemInput = z.infer<typeof postNowItemSchema>;

type BulkPostNowArgs = {
  posts: BulkPostNowItemInput[];
  batch_id?: string;
};

/**
 * MCP tool: publish up to 30 posts immediately in one batch.
 *
 * Plan gate: creator+ (entitlement gate + monthly quota enforced by HOF).
 * Calls: src/actions/server/directPostActions/directPostBatch.ts
 *
 * Thin wrapper: HOF runs the entitlement check + audit, this handler
 * only does shape translation and core delegation. All validation,
 * ownership, URL minting, and dispatch lives in the core.
 *
 * Audit: the full posts array is large, so we summarize args to
 * { count } via auditArgsBuilder for deny + thrown-error paths, and
 * to { count, batch_id } via the handler-returned auditArgs on
 * success / handler-error paths.
 */
export function registerBulkPostNow(server: McpServer): void {
  server.registerTool(
    "bulk_post_now",
    {
      title: "Bulk Post Now",
      description: `Publish up to ${MAX_POSTS_PER_CALL} posts immediately across multiple platforms and accounts. Requires Creator plan or higher. Reuses one media upload across N posts (one entry in the array = one platform+account combo). For Pinterest entries, include pinterest_board_id. Returns event IDs; check list_content_history in 30-60s to confirm.`,
      inputSchema: {
        posts: z
          .array(postNowItemSchema)
          .min(1)
          .max(MAX_POSTS_PER_CALL)
          .describe(
            `Array of posts to publish immediately (max ${MAX_POSTS_PER_CALL}). Each entry = one platform + one social account.`,
          ),
        batch_id: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe(
            "Optional batch_id. When supplied, each post gets idempotency_key = `${batch_id}:${index}`. Retries with the same batch_id are no-ops.",
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
    withMcpTool(
      "bulk_post_now",
      async (ctx, args: BulkPostNowArgs) => {
        const directPostsData: DirectPostData[] = args.posts.map(
          (inputPost) => ({
            socialAccountId: inputPost.social_account_id,
            platform: inputPost.platform,
            postType: inputPost.post_type,
            title: inputPost.title ?? null,
            description: inputPost.description,
            mediaStoragePath: inputPost.media_storage_path,
            coverTimestamp: inputPost.cover_timestamp,
            pinterestBoardId: inputPost.pinterest_board_id,
            pinterestBoardName: inputPost.pinterest_board_name,
            pinterestLink: inputPost.pinterest_link,
          }),
        );

        const postBatchResult = await directPostBatch(
          directPostsData,
          ctx.principal.principalId,
          "mcp",
          args.batch_id,
          ctx.requestId,
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: postBatchResult.success,
                  batch_id: postBatchResult.batchId,
                  total: postBatchResult.details.total,
                  dispatched: postBatchResult.details.dispatched,
                  duplicates: postBatchResult.details.duplicates,
                  rejected: postBatchResult.details.rejected,
                  event_ids: postBatchResult.eventIds,
                  message: postBatchResult.message,
                },
                null,
                2,
              ),
            },
          ],
          isError: !postBatchResult.success,
          auditArgs: {
            count: args.posts.length,
            batch_id: postBatchResult.batchId,
          },
        };
      },
      {
        auditArgsBuilder: (args) => ({ count: args.posts.length }),
      },
    ),
  );
}
