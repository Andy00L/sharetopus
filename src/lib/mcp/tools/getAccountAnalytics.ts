import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withMcpTool } from "../withMcpTool";
import { Platform } from "@/lib/types/database.types";

type GetAccountAnalyticsArgs = {
  platform?: Platform;
  content_id?: string;
  days: number;
  limit: number;
};

/**
 * Reads analytics_metrics for the calling principal's content.
 *
 * Plan gate: creator+.
 * Tables read: analytics_metrics.
 *
 * This returns whatever is stored. We do not refresh metrics on demand
 * in this phase, so data may be up to 24 hours stale. A background job
 * (QStash) refreshes metrics periodically.
 *
 * Output is JSON.stringify. No free-form user text.
 */
export function registerGetAccountAnalytics(server: McpServer): void {
  server.registerTool(
    "get_account_analytics",
    {
      title: "Get Account Analytics",
      description:
        "Fetch performance metrics (views, likes, comments, shares) for your content. Data may be up to 24h old.",
      inputSchema: {
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
      annotations: {
        title: "Get Account Analytics",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    withMcpTool(
      "get_account_analytics",
      async (ctx, args: GetAccountAnalyticsArgs) => {
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - args.days);
        const sinceIsoDate = sinceDate.toISOString().split("T")[0];

        let analyticsQuery = adminSupabase
          .from("analytics_metrics")
          .select("*")
          .eq("principal_id", ctx.principal.principalId)
          .gte("metric_date", sinceIsoDate)
          .order("metric_date", { ascending: false })
          .limit(args.limit);

        if (args.platform) {
          analyticsQuery = analyticsQuery.eq("platform", args.platform);
        }
        if (args.content_id) {
          analyticsQuery = analyticsQuery.eq("content_id", args.content_id);
        }

        const { data: analyticsRows, error: analyticsError } =
          await analyticsQuery;

        if (analyticsError) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to fetch analytics: ${analyticsError.message}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(analyticsRows ?? [], null, 2),
            },
          ],
        };
      },
    ),
  );
}
