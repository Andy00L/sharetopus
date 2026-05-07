import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getContentHistoryInternal } from "@/actions/server/_internal/contentHistoryActions/getContentHistory";
import { entitlementFor } from "../entitlement";
import { logToolCall } from "../audit";
import { extractPrincipal, extractSessionId } from "./index";

/**
 * Lists content that has already been posted.
 *
 * Plan gate: any active subscription.
 * Tables read: content_history, social_accounts (join for avatar_url).
 * Calls: src/actions/server/_internal/contentHistoryActions/getContentHistory.ts
 *
 * Output is JSON.stringify. No free-form user text.
 */
export function registerListContentHistory(server: McpServer): void {
  server.tool(
    "list_content_history",
    "View your posted content history. Optional filter by platform.",
    {
      platform: z
        .enum(["linkedin", "tiktok", "pinterest", "instagram"])
        .optional()
        .describe("Filter by platform"),
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

      const ent = await entitlementFor(principal, "list_content_history");
      if (ent.mode === "deny") {
        await logToolCall({
          principal,
          sessionId,
          toolName: "list_content_history",
          args,
          resultStatus: "denied",
          latencyMs: Date.now() - start,
        });
        return {
          content: [{ type: "text", text: `Denied: ${ent.detail ?? ent.reason}` }],
          isError: true,
        };
      }

      const result = await getContentHistoryInternal(principal.principalId, args);

      await logToolCall({
        principal,
        sessionId,
        toolName: "list_content_history",
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
