import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getScheduledPostsInternal } from "@/actions/server/_internal/scheduleActions/getScheduledPosts";
import { entitlementFor } from "../entitlement";
import { logToolCall } from "../audit";
import { extractPrincipal, extractSessionId } from "./index";

/**
 * Reads scheduled_posts rows owned by the calling principal.
 *
 * Plan gate: any active subscription.
 * Tables read: scheduled_posts, social_accounts (join).
 * Calls: src/actions/server/_internal/scheduleActions/getScheduledPosts.ts
 *
 * Output is JSON.stringify of the rows. No free-form user text returned.
 */
export function registerListScheduledPosts(server: McpServer): void {
  server.tool(
    "list_scheduled_posts",
    "List your scheduled posts. Optional filter by platform or status.",
    {
      platform: z
        .enum(["linkedin", "tiktok", "pinterest", "instagram"])
        .optional()
        .describe("Filter by platform"),
      status: z
        .enum(["scheduled", "processing", "posted", "failed", "cancelled"])
        .optional()
        .describe("Filter by post status"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(20)
        .describe("Max results to return (1-100)"),
    },
    async (args, extra) => {
      const principal = extractPrincipal(extra);
      const sessionId = extractSessionId(extra);
      const start = Date.now();

      const ent = await entitlementFor(principal, "list_scheduled_posts");
      if (ent.mode === "deny") {
        await logToolCall({
          principal,
          sessionId,
          toolName: "list_scheduled_posts",
          args,
          resultStatus: "denied",
          latencyMs: Date.now() - start,
        });
        return {
          content: [{ type: "text", text: `Denied: ${ent.detail ?? ent.reason}` }],
          isError: true,
        };
      }

      const result = await getScheduledPostsInternal(principal.principalId, args);

      await logToolCall({
        principal,
        sessionId,
        toolName: "list_scheduled_posts",
        args,
        resultStatus: result.success ? "ok" : "error",
        latencyMs: Date.now() - start,
      });

      if (!result.success) {
        return { content: [{ type: "text", text: result.message }], isError: true };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result.data ?? [], null, 2) }],
      };
    }
  );
}
