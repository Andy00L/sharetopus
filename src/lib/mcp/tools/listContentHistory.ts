import { getContentHistory } from "@/actions/server/contentHistoryActions/getContentHistory";
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
 * Lists content that has already been posted.
 *
 * Plan gate: any active subscription.
 * Tables read: content_history, social_accounts (join for avatar_url).
 * Calls:src/actions/server/contentHistoryActions/getContentHistory.ts
 *
 * Output is JSON.stringify. No free-form user text.
 */
export function registerListContentHistory(server: McpServer): void {
  server.registerTool(
    "list_content_history",
    {
      title: "List Content History",
      description:
        "View your posted content history. Optional filter by platform.",
      inputSchema: {
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
      annotations: {
        title: "List Content History",
        readOnlyHint: true,
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

      const ent = await entitlementFor(principal, "list_content_history");
      if (ent.mode === "deny") {
        await logToolCall({
          principal,
          sessionId,
          toolName: "list_content_history",
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

      const result = await getContentHistory(
        principal.principalId,
        "mcp",
        args,
      );

      await logToolCall({
        principal,
        sessionId,
        toolName: "list_content_history",
        args,
        resultStatus: result.success ? "ok" : "error",
        latencyMs: Date.now() - start,
        ipHash,
        userAgent,
        clientName,
        clientVersion,
      });

      if (!result.success) {
        return {
          content: [{ type: "text", text: result.message }],
          isError: true,
        };
      }

      return {
        content: [
          { type: "text", text: JSON.stringify(result.data ?? [], null, 2) },
        ],
      };
    },
  );
}
