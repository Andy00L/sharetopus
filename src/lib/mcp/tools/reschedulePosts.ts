import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { updateScheduledTimeBatchInternal } from "@/actions/server/_internal/scheduleActions/updateScheduledTimeBatch";
import { entitlementFor } from "../entitlement";
import { logToolCall } from "../audit";
import { extractPrincipal, extractSessionId, extractIpHash, extractUserAgent, extractClientName, extractClientVersion } from "@/lib/mcp/context";

/**
 * Reschedules posts to a new time. Cancelled posts get resumed automatically.
 *
 * Plan gate: Starter+
 * Tables touched: scheduled_posts (read + update)
 * Calls: src/actions/server/_internal/scheduleActions/updateScheduledTimeBatch.ts
 */
export function registerReschedulePosts(server: McpServer): void {
  server.registerTool(
    "reschedule_posts",
    {
      title: "Reschedule Posts",
      description:
        "Change the scheduled time for one or more posts. Cancelled posts are automatically resumed.",
      inputSchema: {
        post_ids: z
          .array(z.string().uuid())
          .min(1)
          .max(50)
          .describe("Array of post IDs to reschedule"),
        new_scheduled_time: z
          .string()
          .describe("New ISO 8601 datetime (must be in the future)"),
      },
      annotations: {
        title: "Reschedule Posts",
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
      const clientName = extractClientName(extra);
      const clientVersion = extractClientVersion(extra);
      const start = Date.now();

      const ent = await entitlementFor(principal, "reschedule_posts");
      if (ent.mode === "deny") {
        await logToolCall({
          principal,
          sessionId,
          toolName: "reschedule_posts",
          args,
          resultStatus: "denied",
          latencyMs: Date.now() - start,
          ipHash,
          userAgent,
          clientName,
          clientVersion,
        });
        return {
          content: [{ type: "text", text: `Denied: ${ent.detail ?? ent.reason}` }],
          isError: true,
        };
      }

      const result = await updateScheduledTimeBatchInternal(
        args.post_ids,
        args.new_scheduled_time,
        principal.principalId
      );

      await logToolCall({
        principal,
        sessionId,
        toolName: "reschedule_posts",
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
