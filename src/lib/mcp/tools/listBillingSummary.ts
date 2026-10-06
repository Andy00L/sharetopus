import "server-only";

import type { McpServer } from "@modelcontextprotocol/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { db, runQuery } from "@/db/client";
import { usage_quotas } from "@/db/schema";
import { currentQuotaPeriod } from "@/lib/mcp/_shared/currentQuotaPeriod";
import { tierLabel } from "@/lib/types/plans";

import { monthlyCapsForPlan } from "../entitlement";
import { errorResult, jsonResult, withMcpTool } from "../withMcpTool";

const ListBillingSummaryOutputSchema = z.object({
  plan: z.string().nullable(),
  status: z.string(),
  current_period_end: z.string().nullable(),
  period: z.string(),
  usage: z.array(
    z.object({ tool: z.string(), used: z.number(), limit: z.number().nullable() }),
  ),
});

/** The plan, its status, and this month's usage of each capped tool against its limit. */
export function registerListBillingSummary(server: McpServer): void {
  server.registerTool(
    "list_billing_summary",
    {
      title: "List Billing Summary",
      description:
        "Your plan, its status, and this month's calls of each capped tool against its limit (null limit means unlimited).",
      inputSchema: z.object({}),
      outputSchema: ListBillingSummaryOutputSchema,
      annotations: { title: "List Billing Summary", readOnlyHint: true, openWorldHint: false },
    },
    withMcpTool("list_billing_summary", async (ctx) => {
      const subscription = await checkActiveSubscription(ctx.principal.principalId);
      if (subscription.status === "unavailable") {
        return errorResult("Could not read your subscription. Retry in a moment.");
      }

      const period = currentQuotaPeriod();
      const { data: usageRows, error: usageError } = await runQuery(
        db
          .select({ action: usage_quotas.action, count: usage_quotas.count })
          .from(usage_quotas)
          .where(
            and(
              eq(usage_quotas.principal_id, ctx.principal.principalId),
              eq(usage_quotas.period, period),
            ),
          ),
      );
      if (usageError) {
        console.error("[listBillingSummary] usage_quotas read failed:", usageError.message);
        return errorResult("Could not read your usage. Retry in a moment.");
      }

      const usedByTool = new Map(usageRows.map((usageRow) => [usageRow.action, usageRow.count]));
      const caps = ctx.principal.plan ? monthlyCapsForPlan(ctx.principal.plan) : {};

      return jsonResult({
        plan: ctx.principal.plan ? tierLabel(ctx.principal.plan) : null,
        status: subscription.status,
        current_period_end: subscription.isActive ? subscription.currentPeriodEnd : null,
        // The usage_quotas filter is the 1st of the month; agents read YYYY-MM.
        period: period.slice(0, 7),
        usage: Object.entries(caps).map(([toolName, cap]) => ({
          tool: toolName,
          used: usedByTool.get(toolName) ?? 0,
          limit: cap,
        })),
      } satisfies z.infer<typeof ListBillingSummaryOutputSchema>);
    }),
  );
}
