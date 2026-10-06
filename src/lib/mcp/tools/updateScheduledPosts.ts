import "server-only";

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { cancelScheduledPostBatch } from "@/actions/server/scheduleActions/cancel/cancelScheduledPostBatch";
import { updateScheduledTimeBatch } from "@/actions/server/scheduleActions/reschedule/updateScheduledTimeBatch";
import { resumeScheduledPostBatch } from "@/actions/server/scheduleActions/resume/resumeScheduledPostBatch";
import { IsoDateTimeSchema } from "@/lib/mcp/_shared/isoDateTimeSchema";

import { errorResult, jsonResult, withMcpTool } from "../withMcpTool";

type UpdateScheduledPostsArgs = {
  post_ids: string[];
  action: "cancel" | "resume" | "reschedule";
  scheduled_at?: string;
};

const UpdateScheduledPostsOutputSchema = z.object({
  action: z.enum(["cancel", "resume", "reschedule"]),
  updated: z.number(),
  skipped: z.number(),
  message: z.string(),
});

/** Cancels, resumes or reschedules up to 50 scheduled posts; every change can be undone. */
export function registerUpdateScheduledPosts(server: McpServer): void {
  server.registerTool(
    "update_scheduled_posts",
    {
      title: "Update Scheduled Posts",
      description:
        "Change up to 50 scheduled posts. cancel: stops posts in status scheduled. resume: brings cancelled posts back (a past time moves to 1 hour from now). reschedule: sets a new future time and resumes cancelled posts. Get post ids from list_posts.",
      inputSchema: z
        .object({
          post_ids: z.array(z.guid()).min(1).max(50),
          action: z.enum(["cancel", "resume", "reschedule"]),
          scheduled_at: IsoDateTimeSchema
            .optional()
            .describe("Future ISO 8601 time with a zone. Required for reschedule."),
        })
        .refine((args) => args.action !== "reschedule" || Boolean(args.scheduled_at), {
          message: "scheduled_at is required when action is reschedule",
          path: ["scheduled_at"],
        }),
      outputSchema: UpdateScheduledPostsOutputSchema,
      annotations: {
        title: "Update Scheduled Posts",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withMcpTool("update_scheduled_posts", async (ctx, args: UpdateScheduledPostsArgs) => {
      const changeResult = await runChange(args, ctx.principal.principalId, ctx.requestId);
      if (!changeResult.success) {
        return errorResult(changeResult.message);
      }
      return jsonResult({
        action: args.action,
        updated: changeResult.succeeded,
        skipped: changeResult.failed,
        message: changeResult.message,
      } satisfies z.infer<typeof UpdateScheduledPostsOutputSchema>);
    }),
  );
}

type ChangeOutcome =
  | { success: true; succeeded: number; failed: number; message: string }
  | { success: false; message: string };

async function runChange(
  args: UpdateScheduledPostsArgs,
  principalId: string,
  requestId: string | null,
): Promise<ChangeOutcome> {
  switch (args.action) {
    case "cancel": {
      const cancelResult = await cancelScheduledPostBatch(args.post_ids, principalId, "mcp", requestId);
      return cancelResult.success
        ? { success: true, ...cancelResult.details, message: cancelResult.message }
        : { success: false, message: cancelResult.message };
    }
    case "resume": {
      const resumeResult = await resumeScheduledPostBatch(args.post_ids, principalId, "mcp", requestId);
      return resumeResult.success && resumeResult.details
        ? { success: true, ...resumeResult.details, message: resumeResult.message }
        : { success: false, message: resumeResult.message };
    }
    case "reschedule": {
      const rescheduleResult = await updateScheduledTimeBatch(
        args.post_ids,
        args.scheduled_at ?? "",
        principalId,
        "mcp",
        requestId,
      );
      return rescheduleResult.success
        ? { success: true, ...rescheduleResult.details, message: rescheduleResult.message }
        : { success: false, message: rescheduleResult.message };
    }
    default: {
      const unhandledAction: never = args.action;
      return { success: false, message: `Unknown action ${String(unhandledAction)}` };
    }
  }
}
