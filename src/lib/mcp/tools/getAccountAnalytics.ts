import "server-only";

import { db, runQuery } from "@/db/client";
import { analytics_metrics } from "@/db/schema";
import type { Platform } from "@/db/schema";
import type { McpServer } from "@modelcontextprotocol/server";
import { and, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";

import { withMcpTool } from "../withMcpTool";
import { POSTING_PLATFORMS } from "@/lib/platforms/capabilities";

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
      inputSchema: z.object({
        platform: z
          .enum(POSTING_PLATFORMS)
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
      }),
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

        const { data: analyticsRows, error: analyticsError } = await runQuery(
          db
            .select()
            .from(analytics_metrics)
            .where(
              and(
                eq(analytics_metrics.principal_id, ctx.principal.principalId),
                gte(analytics_metrics.metric_date, sinceIsoDate),
                args.platform
                  ? eq(analytics_metrics.platform, args.platform)
                  : undefined,
                args.content_id
                  ? eq(analytics_metrics.content_id, args.content_id)
                  : undefined,
              ),
            )
            .orderBy(desc(analytics_metrics.metric_date))
            .limit(args.limit),
        );

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
