import "server-only";

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { deleteScheduledPostBatch } from "@/actions/server/scheduleActions/delete/deleteScheduledPostBatch";

import { errorResult, jsonResult, withMcpTool } from "../withMcpTool";

const DeleteScheduledPostsOutputSchema = z.object({
  deleted: z.number(),
  skipped: z.number(),
  message: z.string(),
});

/** Permanently deletes scheduled posts and the media no other post still uses. */
export function registerDeleteScheduledPosts(server: McpServer): void {
  server.registerTool(
    "delete_scheduled_posts",
    {
      title: "Delete Scheduled Posts",
      description:
        "Permanently delete up to 50 scheduled posts. Cannot be undone; to stop a post but keep it, use update_scheduled_posts with action cancel.",
      inputSchema: z.object({ post_ids: z.array(z.guid()).min(1).max(50) }),
      outputSchema: DeleteScheduledPostsOutputSchema,
      annotations: {
        title: "Delete Scheduled Posts",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withMcpTool("delete_scheduled_posts", async (ctx, args: { post_ids: string[] }) => {
      const deleteResult = await deleteScheduledPostBatch(
        args.post_ids,
        ctx.principal.principalId,
        "mcp",
        ctx.requestId,
      );
      if (!deleteResult.success) {
        return errorResult(deleteResult.message);
      }
      return jsonResult({
        deleted: deleteResult.details.succeeded,
        skipped: deleteResult.details.failed,
        message: deleteResult.message,
      } satisfies z.infer<typeof DeleteScheduledPostsOutputSchema>);
    }),
  );
}
