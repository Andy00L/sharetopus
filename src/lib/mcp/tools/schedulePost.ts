import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { schedulePostInternal } from "@/actions/server/_internal/scheduleActions/schedulePost";
import { entitlementFor } from "../entitlement";
import { logToolCall } from "../audit";
import { extractPrincipal, extractSessionId, extractIpHash, extractUserAgent } from "@/lib/mcp/context";

/**
 * Schedules a single post for publishing.
 *
 * Plan gate: Starter+
 * Tables touched: scheduled_posts (insert), social_accounts (ownership check)
 * Calls: src/actions/server/_internal/scheduleActions/schedulePost.ts
 *
 * Media can be provided as:
 *   1. A Supabase Storage path the agent previously uploaded to
 *   2. A public HTTP URL (attach_media_from_url tool should be called first)
 * Text posts do not require media.
 */
export function registerSchedulePost(server: McpServer): void {
  server.registerTool(
    "schedule_post",
    {
      title: "Schedule Post",
      description:
        "Schedule a post for publishing at a future time. For media posts, use attach_media_from_url first. For Pinterest, provide pinterest_board_id and optionally pinterest_link.",
      inputSchema: {
        social_account_id: z.string().uuid().describe("ID of the social account to post to"),
        platform: z
          .enum(["linkedin", "tiktok", "pinterest", "instagram"])
          .describe("Target platform"),
        scheduled_at: z
          .string()
          .describe("ISO 8601 datetime for when to publish (must be in the future)"),
        post_type: z
          .enum(["text", "image", "video"])
          .describe("Type of post"),
        title: z.string().optional().describe("Post title (used by some platforms)"),
        description: z.string().nullable().describe("Post body text / caption"),
        media_storage_path: z
          .string()
          .optional()
          .default("")
          .describe("Supabase Storage path for media. Required for image/video posts."),
        batch_id: z
          .string()
          .optional()
          .default("")
          .describe("Optional batch ID to group related posts"),
        pinterest_board_id: z
          .string()
          .optional()
          .describe(
            "Pinterest board ID. Required when platform = 'pinterest'."
          ),
        pinterest_board_name: z
          .string()
          .optional()
          .describe(
            "Pinterest board display name. Optional."
          ),
        pinterest_link: z
          .string()
          .url()
          .max(2048)
          .optional()
          .describe(
            "Destination URL for the Pinterest pin (clickthrough). Max 2048 chars. Optional."
          ),
      },
      annotations: {
        title: "Schedule Post",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args, extra) => {
      const principal = extractPrincipal(extra);
      const sessionId = extractSessionId(extra);
      const ipHash = await extractIpHash();
      const userAgent = await extractUserAgent();
      const start = Date.now();

      const ent = await entitlementFor(principal, "schedule_post");
      if (ent.mode === "deny") {
        await logToolCall({
          principal,
          sessionId,
          toolName: "schedule_post",
          args,
          resultStatus: ent.reason === "platform_quota" ? "quota_exceeded" : "denied",
          latencyMs: Date.now() - start,
          ipHash,
          userAgent,
        });
        return {
          content: [{ type: "text", text: `Denied: ${ent.detail ?? ent.reason}` }],
          isError: true,
        };
      }

      // Pinterest board required
      if (args.platform === "pinterest" && !args.pinterest_board_id) {
        await logToolCall({
          principal,
          sessionId,
          toolName: "schedule_post",
          args,
          resultStatus: "error",
          latencyMs: Date.now() - start,
          ipHash,
          userAgent,
        });
        return {
          content: [
            {
              type: "text",
              text: "pinterest_board_id is required for Pinterest posts. Use list_pinterest_boards to find one.",
            },
          ],
          isError: true,
        };
      }

      // pinterest_* fields only valid for Pinterest
      if (
        (args.pinterest_link ||
          args.pinterest_board_id ||
          args.pinterest_board_name) &&
        args.platform !== "pinterest"
      ) {
        await logToolCall({
          principal,
          sessionId,
          toolName: "schedule_post",
          args,
          resultStatus: "error",
          latencyMs: Date.now() - start,
          ipHash,
          userAgent,
        });
        return {
          content: [
            {
              type: "text",
              text: "pinterest_* fields are only valid when platform = 'pinterest'.",
            },
          ],
          isError: true,
        };
      }

      const postOptions =
        args.platform === "pinterest"
          ? {
              privacyLevel: "PUBLIC" as const,
              board: args.pinterest_board_id ?? "",
              link: args.pinterest_link ?? "",
            }
          : null;

      const result = await schedulePostInternal(
        {
          socialAccountId: args.social_account_id,
          platform: args.platform,
          scheduledAt: args.scheduled_at,
          postType: args.post_type,
          title: args.title ?? null,
          description: args.description,
          mediaStoragePath: args.media_storage_path,
          batch_id: args.batch_id,
          postOptions,
        },
        principal.principalId,
        "mcp"
      );

      await logToolCall({
        principal,
        sessionId,
        toolName: "schedule_post",
        args,
        resultStatus: result.success ? "ok" : "error",
        latencyMs: Date.now() - start,
        ipHash,
        userAgent,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    }
  );
}
