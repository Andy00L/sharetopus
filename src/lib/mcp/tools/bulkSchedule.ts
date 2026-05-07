import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { schedulePostInternal } from "@/actions/server/_internal/scheduleActions/schedulePost";
import { entitlementFor } from "../entitlement";
import { logToolCall } from "../audit";
import { extractPrincipal, extractSessionId } from "./index";

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

/**
 * Schedules up to 30 posts in a single call.
 *
 * Plan gate: Creator+
 * Tables touched: scheduled_posts (insert per post), social_accounts, platform_quotas
 * Calls: src/actions/server/_internal/scheduleActions/schedulePost.ts (per post)
 *
 * Pre-flight checks:
 *   Counts scheduled_posts in the next 24 hours for each (principal, platform)
 *   pair and compares against the platform_quotas.daily_cap. Rejects the
 *   entire batch if any platform would exceed its cap.
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
      const principal = extractPrincipal(extra);
      const sessionId = extractSessionId(extra);
      const start = Date.now();

      const ent = await entitlementFor(principal, "bulk_schedule");
      if (ent.mode === "deny") {
        await logToolCall({
          principal,
          sessionId,
          toolName: "bulk_schedule",
          args: { count: args.posts.length },
          resultStatus: ent.reason === "platform_quota" ? "quota_exceeded" : "denied",
          latencyMs: Date.now() - start,
        });
        return {
          content: [{ type: "text", text: `Denied: ${ent.detail ?? ent.reason}` }],
          isError: true,
        };
      }

      // Pre-flight: check platform daily quotas
      const platforms = [...new Set(args.posts.map((p) => p.platform))];
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      for (const platform of platforms) {
        const postsForPlatform = args.posts.filter((p) => p.platform === platform).length;

        // Count existing scheduled posts in the next 24 hours
        const { count: existingCount } = await adminSupabase
          .from("scheduled_posts")
          .select("id", { count: "exact", head: true })
          .eq("principal_id", principal.principalId)
          .eq("platform", platform)
          .gte("scheduled_at", now.toISOString())
          .lte("scheduled_at", tomorrow.toISOString());

        // Check platform quota
        const { data: quota } = await adminSupabase
          .from("platform_quotas")
          .select("daily_cap")
          .eq("platform", platform)
          .maybeSingle();

        const dailyCap = quota?.daily_cap ?? 50; // default to 50 if no quota row
        const totalAfter = (existingCount ?? 0) + postsForPlatform;

        if (totalAfter > dailyCap) {
          await logToolCall({
            principal,
            sessionId,
            toolName: "bulk_schedule",
            args: { count: args.posts.length, platform },
            resultStatus: "quota_exceeded",
            latencyMs: Date.now() - start,
          });
          return {
            content: [
              {
                type: "text",
                text: `Platform quota exceeded for ${platform}. ${existingCount ?? 0} posts already scheduled in the next 24h, adding ${postsForPlatform} would exceed the daily cap of ${dailyCap}.`,
              },
            ],
            isError: true,
          };
        }
      }

      // Schedule each post
      const batchId = args.batch_id ?? crypto.randomUUID();
      const results: Array<{ index: number; success: boolean; message: string; scheduleId?: string }> = [];

      for (let i = 0; i < args.posts.length; i++) {
        const post = args.posts[i];
        const result = await schedulePostInternal(
          {
            socialAccountId: post.social_account_id,
            platform: post.platform,
            scheduledAt: post.scheduled_at,
            postType: post.post_type,
            title: post.title ?? null,
            description: post.description,
            mediaStoragePath: post.media_storage_path,
            batch_id: batchId,
            postOptions: null,
          },
          principal.principalId
        );
        results.push({ index: i, ...result });
      }

      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      await logToolCall({
        principal,
        sessionId,
        toolName: "bulk_schedule",
        args: { count: args.posts.length, batch_id: batchId },
        resultStatus: failed > 0 ? "error" : "ok",
        latencyMs: Date.now() - start,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { batch_id: batchId, total: args.posts.length, succeeded, failed, results },
              null,
              2
            ),
          },
        ],
        isError: failed === args.posts.length,
      };
    }
  );
}
