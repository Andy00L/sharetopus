import "server-only";

import type { DirectPostData } from "@/actions/server/directPostActions/directPostBatch";
import { directPostBatch } from "@/actions/server/directPostActions/directPostBatch";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { MediaType, Platform } from "@/lib/types/database.types";
import { withMcpTool } from "../withMcpTool";

type PostNowArgs = {
  social_account_id: string;
  platform: Platform;
  post_type: MediaType;
  title?: string;
  description: string | null;
  media_storage_path: string;
  cover_timestamp?: number;
  pinterest_board_id?: string;
  pinterest_board_name?: string;
  pinterest_link?: string;
  batch_id?: string;
  idempotency_key?: string;
};

/**
 * MCP tool: publish ONE post immediately. Wraps the single post into a
 * batch of N=1 and delegates to directPostBatch.
 *
 * Plan gate: starter+ (entitlement gate + monthly quota enforced by HOF).
 * Tables touched: social_accounts (ownership), pending_direct_posts (lock).
 * Inngest events: 1 post.now.
 */
export function registerPostNow(server: McpServer): void {
  server.registerTool(
    "post_now",
    {
      title: "Post Now",
      description:
        "Publish ONE post to ONE platform immediately. For media posts, call attach_media_from_url or request_upload_url first to get a media_storage_path. The media file is cleaned up after this post completes. To publish the same media to multiple platforms in one call, use bulk_post_now. Returns an event_id; check list_content_history in 30-60s to confirm.",
      inputSchema: {
        social_account_id: z
          .string()
          .uuid()
          .describe("ID of the social account to post to"),
        platform: z
          .enum(["linkedin", "tiktok", "pinterest", "instagram"])
          .describe("Target platform"),
        post_type: z.enum(["text", "image", "video"]).describe("Type of post"),
        title: z
          .string()
          .optional()
          .describe("Post title (used by some platforms)"),
        description: z.string().nullable().describe("Post body text / caption"),
        media_storage_path: z
          .string()
          .optional()
          .default("")
          .describe(
            "Supabase Storage path. Required for image/video. Get it from attach_media_from_url.",
          ),
        cover_timestamp: z
          .number()
          .int()
          .min(1000)
          .optional()
          .describe(
            "For TikTok video: cover frame at this millisecond mark (>=1000)",
          ),
        pinterest_board_id: z
          .string()
          .optional()
          .describe("Pinterest board ID. Required for Pinterest posts."),
        pinterest_board_name: z
          .string()
          .optional()
          .describe(
            "Pinterest board display name. Optional, for content_history.",
          ),
        pinterest_link: z
          .string()
          .url()
          .max(2048)
          .optional()
          .describe(
            "Destination URL for the Pinterest pin (clickthrough). Max 2048 chars. Optional.",
          ),
        batch_id: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe(
            "Optional batch_id. When supplied, idempotency_key derives from it so retries with the same batch_id are no-ops.",
          ),
        idempotency_key: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe(
            "Optional client-supplied key for safe retries. Same key + same principal returns the existing event_id instead of dispatching a duplicate. Recommended for agent retries on network errors.",
          ),
      },
      annotations: {
        title: "Post Now",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    withMcpTool("post_now", async (ctx, args: PostNowArgs) => {
      const directPost: DirectPostData = {
        socialAccountId: args.social_account_id,
        platform: args.platform,
        postType: args.post_type,
        title: args.title ?? null,
        description: args.description,
        mediaStoragePath: args.media_storage_path,
        coverTimestamp: args.cover_timestamp,
        pinterestBoardId: args.pinterest_board_id,
        pinterestBoardName: args.pinterest_board_name,
        pinterestLink: args.pinterest_link,
        idempotency_key: args.idempotency_key,
      };

      const postBatchResult = await directPostBatch(
        [directPost],
        ctx.principal.principalId,
        "mcp",
        args.batch_id,
        ctx.requestId,
      );

      if (!postBatchResult.success) {
        const firstRejection = postBatchResult.details.rejected[0];
        const failureMessage = firstRejection
          ? firstRejection.reason
          : postBatchResult.message;
        return {
          content: [{ type: "text", text: failureMessage }],
          isError: true,
        };
      }

      const eventId = postBatchResult.eventIds[0] ?? "";
      const wasIdempotentRetry = postBatchResult.details.duplicates > 0;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                event_id: eventId,
                batch_id: postBatchResult.batchId,
                idempotent_retry: wasIdempotentRetry,
                message: wasIdempotentRetry
                  ? "Idempotent retry: returning existing event_id. No new post dispatched."
                  : "Post dispatched. Check list_content_history in 30-60s to confirm. TikTok posts may take up to 2 minutes (async pull).",
              },
              null,
              2,
            ),
          },
        ],
      };
    }),
  );
}
