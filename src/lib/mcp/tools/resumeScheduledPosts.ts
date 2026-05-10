import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resumeScheduledPostBatchInternal } from "@/actions/server/_internal/scheduleActions/resumeScheduledPostBatch";
import { entitlementFor } from "../entitlement";
import { logToolCall } from "../audit";
import { extractPrincipal, extractSessionId, extractIpHash, extractUserAgent } from "@/lib/mcp/context";

/**
 * Resumes cancelled posts back to "scheduled" status.
 *
 * Plan gate: Starter+
 * Tables touched: scheduled_posts (read + update)
 * Calls: src/actions/server/_internal/scheduleActions/resumeScheduledPostBatch.ts
 *
 * If a post's scheduled_at is in the past, it gets bumped to 1 hour from now.
 */
export function registerResumeScheduledPosts(server: McpServer): void {
  server.tool(
    "resume_scheduled_posts",
    "Resume one or more cancelled posts. Posts with past dates are rescheduled to 1 hour from now.",
    {
      post_ids: z
        .array(z.string().uuid())
        .min(1)
        .max(50)
        .describe("Array of post IDs to resume"),
    },
    async (args, extra) => {
      const principal = extractPrincipal(extra);
      const sessionId = extractSessionId(extra);
      const ipHash = await extractIpHash();
      const userAgent = await extractUserAgent();
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
        });
        return {
          content: [{ type: "text", text: `Denied: ${ent.detail ?? ent.reason}` }],
          isError: true,
        };
      }

      const result = await resumeScheduledPostBatchInternal(
        args.post_ids,
        principal.principalId
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
    }
  );
}
