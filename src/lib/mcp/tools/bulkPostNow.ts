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

/**
 * MCP tool: publish up to 30 posts immediately in one batch.
 *
 * Plan gate: Creator+
 * Calls: src/actions/server/directPostActions/directPostBatch.ts
 *
 * Thin wrapper: entitlement + audit. All validation, ownership, URL
 * minting, and dispatch lives in the core.
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
    async (toolArgs, extra) => {
      const principal = extractPrincipal(extra);
      const sessionId = extractSessionId(extra);
      const ipHash = await extractIpHash();
      const userAgent = await extractUserAgent();
      const clientName = extractClientName(extra);
      const clientVersion = extractClientVersion(extra);
      const startTime = Date.now();

      const entitlement = await entitlementFor(principal, "bulk_post_now");
      if (entitlement.mode === "deny") {
        await logToolCall({
          principal,
          sessionId,
          toolName: "bulk_post_now",
          args: { count: toolArgs.posts.length },
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

      const posts: DirectPostData[] = toolArgs.posts.map((inputPost) => ({
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
      }));

      const result = await directPostBatch(
        posts,
        principal.principalId,
        "mcp",
        toolArgs.batch_id,
      );

      await logToolCall({
        principal,
        sessionId,
        toolName: "bulk_post_now",
        args: { count: toolArgs.posts.length, batch_id: result.batchId },
        resultStatus: result.success ? "ok" : "error",
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
            text: JSON.stringify(
              {
                success: result.success,
                batch_id: result.batchId,
                total: result.details.total,
                dispatched: result.details.dispatched,
                duplicates: result.details.duplicates,
                rejected: result.details.rejected,
                event_ids: result.eventIds,
                message: result.message,
              },
              null,
              2,
            ),
          },
        ],
        isError: !result.success,
      };
    },
  );
}
