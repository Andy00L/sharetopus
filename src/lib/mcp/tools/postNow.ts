import type { DirectPostData } from "@/actions/server/directPostActions/directPostBatch";
import { directPostBatch } from "@/actions/server/directPostActions/directPostBatch";
import {
  extractClientName,
  extractClientVersion,
  extractIpHash,
  extractPrincipal,
  extractSessionId,
  extractUserAgent,
} from "@/lib/mcp/context";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { logToolCall } from "../audit";
import { entitlementFor } from "../entitlement";

/**
 * MCP tool: publish ONE post immediately. Wraps single post into a batch
 * of N=1 and delegates to directPostBatch.
 *
 * Plan gate: Starter+
 * Tables touched: social_accounts (ownership), pending_direct_posts (lock)
 * Inngest events: 1 post.now
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
    async (toolArgs, extra) => {
      const principal = extractPrincipal(extra);
      const sessionId = extractSessionId(extra);
      const ipHash = await extractIpHash();
      const userAgent = await extractUserAgent();
      const clientName = extractClientName(extra);
      const clientVersion = extractClientVersion(extra);
      const startTime = Date.now();

      const entitlement = await entitlementFor(principal, "post_now");
      if (entitlement.mode === "deny") {
        await logToolCall({
          principal,
          sessionId,
          toolName: "post_now",
          args: toolArgs,
          resultStatus:
            entitlement.reason === "platform_quota" ||
            entitlement.reason === "monthly_quota"
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

      const post: DirectPostData = {
        socialAccountId: toolArgs.social_account_id,
        platform: toolArgs.platform,
        postType: toolArgs.post_type,
        title: toolArgs.title ?? null,
        description: toolArgs.description,
        mediaStoragePath: toolArgs.media_storage_path,
        coverTimestamp: toolArgs.cover_timestamp,
        pinterestBoardId: toolArgs.pinterest_board_id,
        pinterestBoardName: toolArgs.pinterest_board_name,
        pinterestLink: toolArgs.pinterest_link,
        idempotency_key: toolArgs.idempotency_key,
      };

      const result = await directPostBatch(
        [post],
        principal.principalId,
        "mcp",
        toolArgs.batch_id,
      );

      await logToolCall({
        principal,
        sessionId,
        toolName: "post_now",
        args: toolArgs,
        resultStatus: result.success ? "ok" : "error",
        latencyMs: Date.now() - startTime,
        ipHash,
        userAgent,
        clientName,
        clientVersion,
      });

      if (!result.success) {
        const firstRejection = result.details.rejected[0];
        return {
          content: [
            {
              type: "text",
              text: firstRejection ? firstRejection.reason : result.message,
            },
          ],
          isError: true,
        };
      }

      const eventId = result.eventIds[0] ?? "";
      const wasIdempotentRetry = result.details.duplicates > 0;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                event_id: eventId,
                batch_id: result.batchId,
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
    },
  );
}
