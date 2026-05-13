import { updateScheduledTimeBatch } from "@/actions/server/scheduleActions/reschedule/updateScheduledTimeBatch";
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
 * Reschedules posts to a new time. Cancelled posts get resumed automatically.
 *
 * Plan gate: Starter+
 * Tables touched: scheduled_posts (read + update)
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
    async (toolArgs, extra) => {
      const principal = extractPrincipal(extra);
      const sessionId = extractSessionId(extra);
      const ipHash = await extractIpHash();
      const userAgent = await extractUserAgent();
      const clientName = extractClientName(extra);
      const clientVersion = extractClientVersion(extra);
      const startTime = Date.now();

      const entitlement = await entitlementFor(principal, "reschedule_posts");
      if (entitlement.mode === "deny") {
        await logToolCall({
          principal,
          sessionId,
          toolName: "reschedule_posts",
          args: toolArgs,
          resultStatus: "denied",
          latencyMs: Date.now() - startTime,
          ipHash,
          userAgent,
          clientName,
          clientVersion,
        });
        return {
          content: [
            {
              type: "text",
              text: `Denied: ${entitlement.detail ?? entitlement.reason}`,
            },
          ],
          isError: true,
        };
      }

      const result = await updateScheduledTimeBatch(
        toolArgs.post_ids,
        toolArgs.new_scheduled_time,
        principal.principalId,
        "mcp",
      );

      await logToolCall({
        principal,
        sessionId,
        toolName: "reschedule_posts",
        args: toolArgs,
        resultStatus: result.success ? "ok" : "error",
        latencyMs: Date.now() - startTime,
        ipHash,
        userAgent,
        clientName,
        clientVersion,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    },
  );
}
