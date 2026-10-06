import "server-only";

import type { McpServer } from "@modelcontextprotocol/server";
import { and, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";

import { db, runQuery } from "@/db/client";
import { analytics_metrics } from "@/db/schema";

import { errorResult, jsonResult, withMcpTool } from "../withMcpTool";

type GetAccountAnalyticsArgs = {
  platform?: string;
  content_id?: string;
  days: number;
  limit: number;
};

const GetAccountAnalyticsOutputSchema = z.object({
  metrics: z.array(
    z.object({
      date: z.string(),
      platform: z.string(),
      content_id: z.string().nullable(),
      views: z.number(),
      likes: z.number(),
      comments: z.number(),
      shares: z.number(),
      subscribers: z.number(),
    }),
  ),
});

/** Stored per-day metrics for the user's content, newest first; refreshed daily, not on demand. */
export function registerGetAccountAnalytics(server: McpServer): void {
  server.registerTool(
    "get_account_analytics",
    {
      title: "Get Account Analytics",
      description:
        "Daily views, likes, comments, shares and subscribers for your content, newest first. Data can be up to 24 h old.",
      inputSchema: z.object({
        platform: z.string().max(32).optional().describe("Platform id, e.g. youtube."),
        content_id: z.string().max(200).optional().describe("A content_id from list_posts (published, detailed)."),
        days: z.number().int().min(1).max(90).optional().default(30),
        limit: z.number().int().min(1).max(100).optional().default(20),
      }),
      outputSchema: GetAccountAnalyticsOutputSchema,
      annotations: { title: "Get Account Analytics", readOnlyHint: true, openWorldHint: false },
    },
    withMcpTool("get_account_analytics", async (ctx, args: GetAccountAnalyticsArgs) => {
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - args.days);

      const { data: analyticsRows, error: analyticsError } = await runQuery(
        db
          .select({
            date: analytics_metrics.metric_date,
            platform: analytics_metrics.platform,
            content_id: analytics_metrics.content_id,
            views: analytics_metrics.views,
            likes: analytics_metrics.likes,
            comments: analytics_metrics.comments,
            shares: analytics_metrics.shares,
            subscribers: analytics_metrics.subscribers,
          })
          .from(analytics_metrics)
          .where(
            and(
              eq(analytics_metrics.principal_id, ctx.principal.principalId),
              gte(analytics_metrics.metric_date, sinceDate.toISOString().slice(0, 10)),
              args.platform ? eq(analytics_metrics.platform, args.platform) : undefined,
              args.content_id ? eq(analytics_metrics.content_id, args.content_id) : undefined,
            ),
          )
          .orderBy(desc(analytics_metrics.metric_date))
          .limit(args.limit),
      );

      if (analyticsError) {
        console.error(
          `[get_account_analytics] [req=${ctx.requestId ?? "?"}] Read failed:`,
          analyticsError.message,
        );
        return errorResult("Could not load analytics. Retry in a moment.");
      }

      return jsonResult({
        metrics: analyticsRows,
      } satisfies z.infer<typeof GetAccountAnalyticsOutputSchema>);
    }),
  );
}
