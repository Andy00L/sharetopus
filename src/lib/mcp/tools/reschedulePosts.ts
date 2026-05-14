import "server-only";

import { updateScheduledTimeBatch } from "@/actions/server/scheduleActions/reschedule/updateScheduledTimeBatch";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withMcpTool } from "../withMcpTool";

type ReschedulePostsArgs = {
  post_ids: string[];
  new_scheduled_time: string;
};

/**
 * Reschedules posts to a new time. Cancelled posts get resumed
 * automatically.
 *
 * Plan gate: starter+.
 * Tables touched: scheduled_posts (read + update).
 * Calls: src/actions/server/scheduleActions/reschedule/updateScheduledTimeBatch.ts
 */
export function registerReschedulePosts(server: McpServer): void {
  server.registerTool(
    "reschedule_posts",
    {
      title: "Reschedule Posts",
      description:
        "Change the scheduled time for one or more posts (up to 50). Cancelled posts are automatically resumed (status returns to scheduled).",
      inputSchema: {
        post_ids: z
          .array(z.string().uuid())
          .min(1)
          .max(50)
          .describe(
            "Array of scheduled_post UUIDs to reschedule. Get IDs from list_scheduled_posts. Up to 50 per call.",
          ),
        new_scheduled_time: z
          .string()
          .describe(
            "New ISO 8601 datetime for the posts (e.g. '2026-06-01T14:30:00Z'). Must be in the future. Past times are rejected.",
          ),
      },
      annotations: {
        title: "Reschedule Posts",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withMcpTool("reschedule_posts", async (ctx, args: ReschedulePostsArgs) => {
      const rescheduleResult = await updateScheduledTimeBatch(
        args.post_ids,
        args.new_scheduled_time,
        ctx.principal.principalId,
        "mcp",
      );

      return {
        content: [
          { type: "text", text: JSON.stringify(rescheduleResult, null, 2) },
        ],
        isError: !rescheduleResult.success,
      };
    }),
  );
}
