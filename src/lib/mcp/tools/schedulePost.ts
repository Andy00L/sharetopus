import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { schedulePostInternal } from "@/actions/server/_internal/scheduleActions/schedulePost";
import { entitlementFor } from "../entitlement";
import { logToolCall } from "../audit";
import { extractPrincipal, extractSessionId } from "@/lib/mcp/context";

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
  server.tool(
    "schedule_post",
    "Schedule a post for publishing at a future time. For media posts, use attach_media_from_url first.",
    {
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
    },
    async (args, extra) => {
      const principal = extractPrincipal(extra);
      const sessionId = extractSessionId(extra);
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
        });
        return {
          content: [{ type: "text", text: `Denied: ${ent.detail ?? ent.reason}` }],
          isError: true,
        };
      }

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
          postOptions: null,
        },
        principal.principalId
      );

      await logToolCall({
        principal,
        sessionId,
        toolName: "schedule_post",
        args,
        resultStatus: result.success ? "ok" : "error",
        latencyMs: Date.now() - start,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    }
  );
}
