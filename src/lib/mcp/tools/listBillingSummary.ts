import { adminSupabase } from "@/actions/api/adminSupabase";
import { currentQuotaPeriod } from "@/lib/mcp/_shared/currentQuotaPeriod";
import { tierLabel } from "@/lib/types/plans";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import "server-only";

import { withMcpTool } from "../withMcpTool";

/**
 * Fetches the raw subscription row for a user.
 * Returns errors as values so the handler never sees a raw { data, error }.
 */
async function fetchSubscription(userId: string): Promise<{
  success: boolean;
  message: string;
  subscription?: {
    plan: string | null;
    status: string;
    start_date: string;
    current_period_end: string | null;
  };
}> {
  const { data: subscriptionRow, error: subscriptionError } =
    await adminSupabase
      .from("stripe_subscriptions")
      .select("plan, status, start_date, current_period_end")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

  if (subscriptionError) {
    return {
      success: false,
      message: `Failed to fetch subscription: ${subscriptionError.message}`,
    };
  }

  if (!subscriptionRow) {
    return { success: true, message: "No subscription found" };
  }

  return {
    success: true,
    message: "Subscription found",
    subscription: subscriptionRow,
  };
}

/**
 * Returns the user's current subscription status and usage quotas.
 *
 * Plan gate: free (any active subscription).
 * Tables read: stripe_subscriptions, usage_quotas
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
      const subscriptionResult = await fetchSubscription(
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
                subscription: subscriptionResult.subscription
                  ? {
                      plan_tier: ctx.principal.plan,
                      plan_label: ctx.principal.plan
                        ? tierLabel(ctx.principal.plan)
                        : "None",
                      price_id: subscriptionResult.subscription.plan,
                      status: subscriptionResult.subscription.status,
                      start_date: subscriptionResult.subscription.start_date,
                      current_period_end:
                        subscriptionResult.subscription.current_period_end,
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
