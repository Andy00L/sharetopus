import "server-only";

import { resumeScheduledPostBatch } from "@/actions/server/scheduleActions/resume/resumeScheduledPostBatch";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import { withMcpTool } from "../withMcpTool";

type ResumeScheduledPostsArgs = {
  post_ids: string[];
};

/**
 * Resumes cancelled posts back to "scheduled" status.
 *
 * Plan gate: starter+.
 * Tables touched: scheduled_posts (read + update).
 * Calls: src/actions/server/scheduleActions/resume/resumeScheduledPostBatch.ts
 *
 * If a post's scheduled_at is in the past, it gets bumped to 1 hour
 * from now.
 */
export function registerResumeScheduledPosts(server: McpServer): void {
  server.registerTool(
    "resume_scheduled_posts",
    {
      title: "Resume Scheduled Posts",
      description:
        "Resume one or more cancelled posts. Posts with past dates are rescheduled to 1 hour from now.",
      inputSchema: {
        post_ids: z
          .array(z.string().uuid())
          .min(1)
          .max(50)
          .describe("Array of post IDs to resume"),
      },
      annotations: {
        title: "Resume Scheduled Posts",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withMcpTool(
      "resume_scheduled_posts",
      async (ctx, args: ResumeScheduledPostsArgs) => {
        const resumeResult = await resumeScheduledPostBatch(
          args.post_ids,
          ctx.principal.principalId,
          "mcp",
          ctx.requestId,
        );

        return {
          content: [
            { type: "text", text: JSON.stringify(resumeResult, null, 2) },
          ],
          isError: !resumeResult.success,
        };
      },
    ),
  );
}
