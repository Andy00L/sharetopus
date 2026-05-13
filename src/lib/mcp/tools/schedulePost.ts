// src/lib/mcp/tools/schedulePost.ts
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

/**
 * MCP tool: schedule a single post for future publishing.
 *
 * Plan gate: Starter+
 * Tables touched: scheduled_posts (insert), social_accounts (ownership check),
 *                 platform_quotas (daily cap check)
 * Calls: src/actions/server/scheduleActions/schedule/schedulePostBatch.ts
 *
 * Implementation: wraps the single post into a batch of N=1.
 * Same code path as bulk_schedule, just unwraps the single result.
 */
export function registerSchedulePost(server: McpServer): void {
  server.registerTool(
    "schedule_post",
    {
      title: "Schedule Post",
      description:
        "Schedule a post for publishing at a future time. For media posts, use attach_media_from_url first to upload your media to Supabase Storage. For Pinterest, provide pinterest_board_id and optionally pinterest_link. Use list_connections to find available social account IDs.",
      inputSchema: {
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
            "ISO 8601 datetime string for when to publish (e.g. '2026-06-01T14:30:00Z'). Must be in the future. Past dates are rejected.",
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
            "Optional post title. Used by Pinterest (pin title) and YouTube. Ignored by LinkedIn/TikTok/Instagram which only use description.",
          ),
        description: z
          .string()
          .nullable()
          .describe(
            "Post body text / caption. Required for text posts. Optional but recommended for media posts. Set to null for media-only posts.",
          ),
        media_storage_path: z
          .string()
          .optional()
          .default("")
          .describe(
            "Supabase Storage path for the media file. Required for image/video posts. Get this by calling attach_media_from_url first. Format: 'principal_id/filename.ext'.",
          ),
        batch_id: z
          .string()
          .optional()
          .describe(
            "Optional batch ID to group this post with related posts (e.g. when cross-posting to multiple platforms). If omitted, server generates one.",
          ),
        pinterest_board_id: z
          .string()
          .optional()
          .describe(
            "Pinterest board ID where the pin will be posted. REQUIRED when platform='pinterest'. Get available boards via list_pinterest_boards.",
          ),
        pinterest_board_name: z
          .string()
          .optional()
          .describe(
            "Optional Pinterest board display name. Cosmetic, used in confirmations. Only valid when platform='pinterest'.",
          ),
        pinterest_link: z
          .string()
          .url()
          .max(2048)
          .optional()
          .describe(
            "Destination URL for the Pinterest pin (where users go when they click). Max 2048 chars. Only valid when platform='pinterest'.",
          ),
        idempotency_key: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe(
            "Optional client-supplied key for safe retries. Same key + same principal returns the existing post instead of inserting a duplicate. Strongly recommended for agent retries after network errors or timeouts.",
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
    async (toolArgs, extra) => {
      const principal = extractPrincipal(extra);
      const sessionId = extractSessionId(extra);
      const ipHash = await extractIpHash();
      const userAgent = await extractUserAgent();
      const clientName = extractClientName(extra);
      const clientVersion = extractClientVersion(extra);
      const startTime = Date.now();

      // Plan-tier gate (MCP-specific, separate from web's Clerk subscription).
      const entitlement = await entitlementFor(principal, "schedule_post");
      if (entitlement.mode === "deny") {
        await logToolCall({
          principal,
          sessionId,
          toolName: "schedule_post",
          args: toolArgs,
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

      // Pinterest options only when platform is pinterest. Core re-validates.
      const postOptions =
        toolArgs.platform === "pinterest"
          ? {
              privacyLevel: "PUBLIC" as const,
              board: toolArgs.pinterest_board_id ?? "",
              link: toolArgs.pinterest_link ?? "",
            }
          : null;

      const post: SchedulePostData = {
        socialAccountId: toolArgs.social_account_id,
        platform: toolArgs.platform,
        scheduledAt: toolArgs.scheduled_at,
        postType: toolArgs.post_type,
        title: toolArgs.title ?? null,
        description: toolArgs.description,
        mediaStoragePath: toolArgs.media_storage_path,
        postOptions,
        batch_id: toolArgs.batch_id ?? generateBatchId(),
        idempotency_key: toolArgs.idempotency_key,
      };

      const scheduleResult = await schedulePostBatch(
        [post],
        principal.principalId,
        "mcp",
      );

      await logToolCall({
        principal,
        sessionId,
        toolName: "schedule_post",
        args: toolArgs,
        resultStatus: scheduleResult.success ? "ok" : "error",
        latencyMs: Date.now() - startTime,
        ipHash,
        userAgent,
        clientName,
        clientVersion,
      });

      // Failure path: surface per-post rejection if any, else generic message.
      if (!scheduleResult.success) {
        const firstRejection = scheduleResult.details.rejected[0];
        const userFacingMessage = firstRejection
          ? firstRejection.reason
          : scheduleResult.message;
        return {
          content: [{ type: "text", text: userFacingMessage }],
          isError: true,
        };
      }

      // Success path: unwrap the single result.
      const scheduleId = scheduleResult.scheduleIds[0] ?? null;
      const wasIdempotentRetry = scheduleResult.details.duplicates > 0;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                schedule_id: scheduleId,
                batch_id: scheduleResult.batchId,
                idempotent_retry: wasIdempotentRetry,
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
