import "server-only";

import { getScheduledPosts } from "@/actions/server/scheduleActions/getScheduledPosts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import { withMcpTool } from "../withMcpTool";
import { POSTING_PLATFORMS } from "@/lib/platforms/capabilities";
import { Platform, PostStatus } from "@/lib/types/database.types";

type ListScheduledPostsArgs = {
  platform?: Platform;
  status?: PostStatus;
  limit: number;
};

/**
 * Reads scheduled_posts rows owned by the calling principal.
 *
 * Plan gate: free (any active subscription).
 * Tables read: scheduled_posts, social_accounts (join).
 * Calls: src/actions/server/scheduleActions/getScheduledPosts.ts
 *
 * Output is JSON.stringify of the rows. No free-form user text returned.
 */
export function registerListScheduledPosts(server: McpServer): void {
  server.registerTool(
    "list_scheduled_posts",
    {
      title: "List Scheduled Posts",
      description:
        "List your scheduled posts. Optional filter by platform or status.",
      inputSchema: {
        platform: z
          .enum(POSTING_PLATFORMS)
          .optional()
          .describe("Filter by platform"),
        status: z
          .enum(["scheduled", "processing", "posted", "failed", "cancelled"])
          .optional()
          .describe("Filter by post status"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(20)
          .describe("Max results to return (1-100)"),
      },
      annotations: {
        title: "List Scheduled Posts",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    withMcpTool(
      "list_scheduled_posts",
      async (ctx, args: ListScheduledPostsArgs) => {
        const scheduledPostsResult = await getScheduledPosts(
          ctx.principal.principalId,
          "mcp",
          args,
        );

        if (!scheduledPostsResult.success) {
          return {
            content: [{ type: "text", text: scheduledPostsResult.message }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(scheduledPostsResult.data ?? [], null, 2),
            },
          ],
        };
      },
    ),
  );
}
