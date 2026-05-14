import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { currentQuotaPeriod } from "@/lib/mcp/_shared/currentQuotaPeriod";
import { tierLabel } from "@/lib/types/plans";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import "server-only";

import { withMcpTool } from "../withMcpTool";

/**
 * Returns the user's current subscription status and usage quotas.
 *
 * Plan gate: creator (any active subscription at creator or above).
 * Tables read: stripe_subscriptions (via checkActiveSubscription), usage_quotas
 *
 * No free-form user text in the output.
 */
export function registerListBillingSummary(server: McpServer): void {
  server.registerTool(
    "list_billing_summary",
    {
      title: "List Billing Summary",
      description:
        "View your current subscription plan, status, and usage quota counts for the current month.",
      inputSchema: {},
      annotations: {
        title: "List Billing Summary",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    withMcpTool("list_billing_summary", async (ctx) => {
      const subscription = await checkActiveSubscription(
        ctx.principal.principalId,
      );

      // Fetch current month usage.
      // Query filter uses YYYY-MM-DD (matches the date column in usage_quotas).
      // The display `period` field below stays YYYY-MM because it is user-facing.
      const periodFilter = currentQuotaPeriod();
      const { data: usageQuotas } = await adminSupabase
        .from("usage_quotas")
        .select("action, count")
        .eq("principal_id", ctx.principal.principalId)
        .eq("period", periodFilter);

      const usageByAction = (usageQuotas ?? []).reduce(
        (accumulator, quotaRow) => {
          accumulator[quotaRow.action] = quotaRow.count;
          return accumulator;
        },
        {} as Record<string, number>,
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                subscription: subscription.isActive
                  ? {
                      plan_tier: ctx.principal.plan,
                      plan_label: ctx.principal.plan
                        ? tierLabel(ctx.principal.plan)
                        : "None",
                      price_id: subscription.priceId,
                      status: subscription.status,
                      start_date: subscription.startDate,
                      current_period_end: subscription.currentPeriodEnd,
                    }
                  : null,
                usage_this_month: usageByAction,
                // Display YYYY-MM (user-facing); the DB filter above uses YYYY-MM-DD.
                period: periodFilter.slice(0, 7),
              },
              null,
              2,
            ),
          },
        ],
      };
    }),
  );
}
