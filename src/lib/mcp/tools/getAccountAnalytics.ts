import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { entitlementFor } from "../entitlement";
import { logToolCall } from "../audit";
import { extractPrincipal, extractSessionId } from "@/lib/mcp/context";

/**
 * Reads analytics_metrics for the calling principal's content.
 *
 * Plan gate: Creator+
 * Tables read: analytics_metrics
 *
 * This returns whatever is stored. We do not refresh metrics on demand
 * in this phase, so data may be up to 24 hours stale. A background job
 * (QStash) refreshes metrics periodically.
 *
 * Output is JSON.stringify. No free-form user text.
 */
export function registerGetAccountAnalytics(server: McpServer): void {
  server.tool(
    "get_account_analytics",
    "Fetch performance metrics (views, likes, comments, shares) for your content. Data may be up to 24h old.",
    {
      platform: z
        .enum(["linkedin", "tiktok", "pinterest", "instagram"])
        .optional()
        .describe("Filter by platform"),
      content_id: z
        .string()
        .optional()
        .describe("Filter by specific content ID"),
      days: z
        .number()
        .int()
        .min(1)
        .max(90)
        .optional()
        .default(30)
        .describe("Number of days to look back (1-90)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(20)
        .describe("Max results to return"),
    },
    async (args, extra) => {
      const principal = extractPrincipal(extra);
      const sessionId = extractSessionId(extra);
      const start = Date.now();

      const ent = await entitlementFor(principal, "get_account_analytics");
      if (ent.mode === "deny") {
        await logToolCall({
          principal,
          sessionId,
          toolName: "get_account_analytics",
          args,
          resultStatus: "denied",
          latencyMs: Date.now() - start,
        });
        return {
          content: [{ type: "text", text: `Denied: ${ent.detail ?? ent.reason}` }],
          isError: true,
        };
      }

      const since = new Date();
      since.setDate(since.getDate() - args.days);

      let query = adminSupabase
        .from("analytics_metrics")
        .select("*")
        .eq("principal_id", principal.principalId)
        .gte("metric_date", since.toISOString().split("T")[0])
        .order("metric_date", { ascending: false })
        .limit(args.limit);

      if (args.platform) {
        query = query.eq("platform", args.platform);
      }
      if (args.content_id) {
        query = query.eq("content_id", args.content_id);
      }

      const { data, error } = await query;

      await logToolCall({
        principal,
        sessionId,
        toolName: "get_account_analytics",
        args,
        resultStatus: error ? "error" : "ok",
        latencyMs: Date.now() - start,
      });

      if (error) {
        return {
          content: [{ type: "text", text: `Failed to fetch analytics: ${error.message}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      };
    }
  );
}
