import { getScheduledPosts } from "@/actions/server/scheduleActions/getScheduledPosts";
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
 * Reads scheduled_posts rows owned by the calling principal.
 *
 * Plan gate: any active subscription.
 * Tables read: scheduled_posts, social_accounts (join).
 * Calls: src/actions/server/scheduleActions/get/getScheduledPosts.ts
 *
 * Output is JSON.stringify of the rows. No free-form user text returned.
 */
export function registerListScheduledPosts(server: McpServer): void {
  server.registerTool(
    "list_scheduled_posts",
    {
      title: "List Scheduled Posts",
      description:
        "List your scheduled posts. Optional filter by platform or status.",
      inputSchema: {
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
      annotations: {
        title: "List Scheduled Posts",
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

      const ent = await entitlementFor(principal, "list_scheduled_posts");
      if (ent.mode === "deny") {
        await logToolCall({
          principal,
          sessionId,
          toolName: "list_scheduled_posts",
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

      const result = await getScheduledPosts(
        principal.principalId,
        "mcp",
        args,
      );

      await logToolCall({
        principal,
        sessionId,
        toolName: "list_scheduled_posts",
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
