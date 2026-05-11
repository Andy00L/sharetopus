import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { cancelScheduledPostBatchInternal } from "@/actions/server/_internal/scheduleActions/cancelScheduledPostBatch";
import { entitlementFor } from "../entitlement";
import { logToolCall } from "../audit";
import { extractPrincipal, extractSessionId, extractIpHash, extractUserAgent } from "@/lib/mcp/context";

/**
 * Cancels one or more scheduled posts (sets status to "cancelled").
 *
 * Plan gate: Starter+
 * Tables touched: scheduled_posts (read + update)
 * Calls: src/actions/server/_internal/scheduleActions/cancelScheduledPostBatch.ts
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
    async (args, extra) => {
      const principal = extractPrincipal(extra);
      const sessionId = extractSessionId(extra);
      const ipHash = await extractIpHash();
      const userAgent = await extractUserAgent();
      const start = Date.now();

      const ent = await entitlementFor(principal, "cancel_scheduled_posts");
      if (ent.mode === "deny") {
        await logToolCall({
          principal,
          sessionId,
          toolName: "cancel_scheduled_posts",
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

      const result = await cancelScheduledPostBatchInternal(
        args.post_ids,
        principal.principalId
      );

      await logToolCall({
        principal,
        sessionId,
        toolName: "cancel_scheduled_posts",
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
