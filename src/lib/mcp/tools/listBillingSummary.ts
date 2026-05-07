import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { entitlementFor } from "../entitlement";
import { logToolCall } from "../audit";
import { extractPrincipal, extractSessionId } from "./index";

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

      // Fetch subscription
      const { data: sub } = await adminSupabase
        .from("stripe_subscriptions")
        .select("plan, status, start_date, current_period_end")
        .eq("user_id", principal.principalId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

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
                subscription: sub
                  ? {
                      plan: sub.plan,
                      status: sub.status,
                      start_date: sub.start_date,
                      current_period_end: sub.current_period_end,
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
