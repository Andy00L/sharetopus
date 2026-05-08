import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { entitlementFor } from "../entitlement";
import { logToolCall } from "../audit";
import { extractPrincipal, extractSessionId } from "@/lib/mcp/context";
import { tierLabel } from "@/lib/types/plans";

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
  const { data, error } = await adminSupabase
    .from("stripe_subscriptions")
    .select("plan, status, start_date, current_period_end")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return {
      success: false,
      message: `Failed to fetch subscription: ${error.message}`,
    };
  }

  if (!data) {
    return { success: true, message: "No subscription found" };
  }

  return {
    success: true,
    message: "Subscription found",
    subscription: data,
  };
}

/**
 * Returns the user's current subscription status and usage quotas.
 *
 * Plan gate: any active subscription.
 * Tables read: stripe_subscriptions, usage_quotas
 *
 * No free-form user text in the output.
 */
export function registerListBillingSummary(server: McpServer): void {
  server.tool(
    "list_billing_summary",
    "View your current subscription plan, status, and usage quota counts for the current month.",
    {},
    async (_args, extra) => {
      const principal = extractPrincipal(extra);
      const sessionId = extractSessionId(extra);
      const start = Date.now();

      const ent = await entitlementFor(principal, "list_billing_summary");
      if (ent.mode === "deny") {
        await logToolCall({
          principal,
          sessionId,
          toolName: "list_billing_summary",
          args: null,
          resultStatus: "denied",
          latencyMs: Date.now() - start,
        });
        return {
          content: [{ type: "text", text: `Denied: ${ent.detail ?? ent.reason}` }],
          isError: true,
        };
      }

      const subResult = await fetchSubscription(principal.principalId);

      // Fetch current month usage
      const period = new Date().toISOString().slice(0, 7);
      const { data: quotas } = await adminSupabase
        .from("usage_quotas")
        .select("action, count")
        .eq("principal_id", principal.principalId)
        .eq("period", period);

      await logToolCall({
        principal,
        sessionId,
        toolName: "list_billing_summary",
        args: null,
        resultStatus: "ok",
        latencyMs: Date.now() - start,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                subscription: subResult.subscription
                  ? {
                      plan_tier: principal.plan,
                      plan_label: tierLabel(principal.plan),
                      price_id: subResult.subscription.plan,
                      status: subResult.subscription.status,
                      start_date: subResult.subscription.start_date,
                      current_period_end: subResult.subscription.current_period_end,
                    }
                  : null,
                usage_this_month: (quotas ?? []).reduce(
                  (acc, q) => {
                    acc[q.action] = q.count;
                    return acc;
                  },
                  {} as Record<string, number>
                ),
                period,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
