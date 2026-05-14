import "server-only";

import { cancelScheduledPostBatch } from "@/actions/server/scheduleActions/cancel/cancelScheduledPostBatch";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withMcpTool } from "../withMcpTool";

type CancelScheduledPostsArgs = {
  post_ids: string[];
};

/**
 * Cancels one or more scheduled posts (sets status to "cancelled").
 *
 * Plan gate: starter+.
 * Tables touched: scheduled_posts (read + update).
 * Calls: src/actions/server/scheduleActions/cancel/cancelScheduledPostBatch.ts
 */
export function registerCancelScheduledPosts(server: McpServer): void {
  server.registerTool(
    "cancel_scheduled_posts",
    {
      title: "Cancel Scheduled Posts",
      description:
        "Cancel one or more scheduled posts. Only posts with status 'scheduled' can be cancelled.",
      inputSchema: {
        post_ids: z
          .array(z.string().uuid())
          .min(1)
          .max(50)
          .describe("Array of post IDs to cancel"),
      },
      annotations: {
        title: "Cancel Scheduled Posts",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withMcpTool(
      "cancel_scheduled_posts",
      async (ctx, args: CancelScheduledPostsArgs) => {
        const cancelResult = await cancelScheduledPostBatch(
          args.post_ids,
          ctx.principal.principalId,
          "mcp",
        );

        return {
          content: [
            { type: "text", text: JSON.stringify(cancelResult, null, 2) },
          ],
          isError: !cancelResult.success,
        };
      },
    ),
  );
}
