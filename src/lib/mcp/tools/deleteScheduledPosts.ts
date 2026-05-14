import "server-only";

import { deleteScheduledPostBatch } from "@/actions/server/scheduleActions/delete/deleteScheduledPostBatch";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withMcpTool } from "../withMcpTool";

type DeleteScheduledPostsArgs = {
  post_ids: string[];
};

/**
 * Permanently deletes scheduled posts and cleans up orphaned media.
 *
 * Plan gate: starter+.
 * Tables touched: scheduled_posts (read + delete), Supabase Storage
 *                 (delete orphaned media).
 * Calls: src/actions/server/scheduleActions/delete/deleteScheduledPostBatch.ts
 *
 * The internal batch function mirrors the web UI delete flow,
 * including storage cleanup for media files no longer referenced by
 * any remaining post.
 */
export function registerDeleteScheduledPosts(server: McpServer): void {
  server.registerTool(
    "delete_scheduled_posts",
    {
      title: "Delete Scheduled Posts",
      description:
        "Permanently delete one or more scheduled posts. This action cannot be undone.",
      inputSchema: {
        post_ids: z
          .array(z.string().uuid())
          .min(1)
          .max(50)
          .describe("Array of post IDs to delete"),
      },
      annotations: {
        title: "Delete Scheduled Posts",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withMcpTool(
      "delete_scheduled_posts",
      async (ctx, args: DeleteScheduledPostsArgs) => {
        const deleteResult = await deleteScheduledPostBatch(
          args.post_ids,
          ctx.principal.principalId,
          "mcp",
        );

        return {
          content: [
            { type: "text", text: JSON.stringify(deleteResult, null, 2) },
          ],
          isError: !deleteResult.success,
        };
      },
    ),
  );
}
