import { resumeScheduledPostBatch } from "@/actions/server/scheduleActions/resume/resumeScheduledPostBatch";
import {
  extractClientName,
  extractClientVersion,
  extractIpHash,
  extractPrincipal,
  extractSessionId,
  extractUserAgent,
} from "@/lib/mcp/context";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { logToolCall } from "../audit";
import { entitlementFor } from "../entitlement";

/**
 * Resumes cancelled posts back to "scheduled" status.
 *
 * Plan gate: Starter+
 * Tables touched: scheduled_posts (read + update)
 * Calls: src/actions/server/scheduleActions/resume/resumeScheduledPostBatch.ts
 *
 * If a post's scheduled_at is in the past, it gets bumped to 1 hour from now.
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
    async (args, extra) => {
      const principal = extractPrincipal(extra);
      const sessionId = extractSessionId(extra);
      const ipHash = await extractIpHash();
      const userAgent = await extractUserAgent();
      const clientName = extractClientName(extra);
      const clientVersion = extractClientVersion(extra);
      const start = Date.now();

      const ent = await entitlementFor(principal, "resume_scheduled_posts");
      if (ent.mode === "deny") {
        await logToolCall({
          principal,
          sessionId,
          toolName: "resume_scheduled_posts",
          args,
          resultStatus: "denied",
          latencyMs: Date.now() - start,
          ipHash,
          userAgent,
          clientName,
          clientVersion,
        });
        return {
          content: [
            { type: "text", text: `Denied: ${ent.detail ?? ent.reason}` },
          ],
          isError: true,
        };
      }

      const result = await resumeScheduledPostBatch(
        args.post_ids,
        principal.principalId,
        "mcp",
      );

      await logToolCall({
        principal,
        sessionId,
        toolName: "resume_scheduled_posts",
        args,
        resultStatus: result.success ? "ok" : "error",
        latencyMs: Date.now() - start,
        ipHash,
        userAgent,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    },
  );
}
