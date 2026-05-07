import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import type { McpPrincipal } from "./auth";

/**
 * Result of an entitlement check. Tool handlers branch on `mode`.
 */
export type Entitlement =
  | { mode: "allow"; reason: "plan" }
  | {
      mode: "deny";
      reason: "no_subscription" | "plan_too_low" | "rate_limit" | "platform_quota";
      detail?: string;
    };

/**
 * Plan tiers in ascending order of privilege.
 * "free" means any active subscription (we treat the lowest tier as free-equivalent).
 */
const PLAN_RANK: Record<string, number> = {
  free: 0,
  starter: 1,
  creator: 2,
  pro: 3,
};

/**
 * Maps each MCP action to the minimum plan tier required.
 *
 * Read-only tools are available to any active subscriber.
 * Write tools require Starter+.
 * bulk_schedule and analytics require Creator+.
 * generate_post_draft requires Pro because it uses client-side sampling
 * and we want to gate the capability to paying users.
 */
const ACTION_PLAN_GATE: Record<string, string> = {
  // Read tools (free tier)
  list_connections: "free",
  list_scheduled_posts: "free",
  list_content_history: "free",
  list_billing_summary: "free",

  // Write tools (starter+)
  schedule_post: "starter",
  cancel_scheduled_posts: "starter",
  resume_scheduled_posts: "starter",
  reschedule_posts: "starter",
  delete_scheduled_posts: "starter",
  attach_media_from_url: "starter",
  request_account_reauth_link: "starter",

  // Advanced tools (creator+)
  bulk_schedule: "creator",
  get_account_analytics: "creator",

  // AI tools (pro)
  generate_post_draft: "pro",
};

/**
 * Monthly quota caps per action per plan tier.
 * Only write actions that hit external APIs need caps.
 * null means unlimited.
 */
const MONTHLY_CAPS: Record<string, Record<string, number | null>> = {
  schedule_post: { free: 10, starter: 100, creator: 500, pro: null },
  bulk_schedule: { free: 0, starter: 0, creator: 200, pro: null },
  generate_post_draft: { free: 0, starter: 0, creator: 0, pro: 100 },
};

/**
 * Checks whether a principal is entitled to perform the given action.
 *
 * Runs on every MCP tool call. The plan tier is read from `principal.plan`,
 * which auth.ts populates from checkActiveSubscription on every request.
 *
 * Order of checks:
 *   1. Read the plan cached on the principal (set by auth.ts).
 *   2. Compare against the minimum tier for the requested action.
 *   3. If the action has a monthly cap, call atomic_increment_quota RPC.
 *
 * Tables read: usage_quotas (via RPC)
 * Tables written: usage_quotas (via RPC, atomic increment)
 *
 * Called by: every tool handler before doing any real work
 */
export async function entitlementFor(
  principal: McpPrincipal,
  action: string
): Promise<Entitlement> {
  // 1. Read the plan cached on the principal by auth.ts
  const plan = principal.plan;
  if (!plan) {
    // This branch should never fire: auth.ts blocks unauthenticated
    // users and sets plan after the subscription gate. Log it so we
    // notice if it does.
    console.error(
      `[entitlement] principal.plan is null for ${principal.principalId}. ` +
        "auth.ts should have blocked this request or set a plan."
    );
    return {
      mode: "deny",
      reason: "no_subscription",
      detail: "No active subscription found. Subscribe at sharetopus.com to use MCP tools.",
    };
  }

  // 2. Check plan tier
  const requiredPlan = ACTION_PLAN_GATE[action] ?? "free";
  const userRank = PLAN_RANK[plan] ?? 0;
  const requiredRank = PLAN_RANK[requiredPlan] ?? 0;

  if (userRank < requiredRank) {
    return {
      mode: "deny",
      reason: "plan_too_low",
      detail: `Action "${action}" requires the ${requiredPlan} plan or higher. You are on the ${plan} plan.`,
    };
  }

  // 3. Check monthly quota (only for actions that have caps)
  const caps = MONTHLY_CAPS[action];
  if (caps) {
    const cap = caps[plan];
    if (cap === 0) {
      return {
        mode: "deny",
        reason: "platform_quota",
        detail: `Action "${action}" is not available on the ${plan} plan.`,
      };
    }
    if (cap !== null && cap !== undefined) {
      const quotaResult = await checkAndIncrementQuota(
        principal.principalId,
        action,
        cap
      );
      if (!quotaResult.allowed) {
        return {
          mode: "deny",
          reason: "platform_quota",
          detail: `Monthly quota exceeded for "${action}". Used ${quotaResult.currentCount}/${cap}. Resets next month.`,
        };
      }
    }
  }

  return { mode: "allow", reason: "plan" };
}

/**
 * Atomically increments the usage counter for a principal+action pair and
 * returns whether the caller is still within the cap.
 *
 * Calls the `atomic_increment_quota` Postgres function which performs the
 * check-and-increment in a single statement, closing the race window that
 * existed in the old read-then-upsert approach.
 *
 * When the function returns null, the cap was already reached.
 */
async function checkAndIncrementQuota(
  principalId: string,
  action: string,
  cap: number
): Promise<{ allowed: boolean; currentCount: number }> {
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM

  const { data, error } = await adminSupabase.rpc("atomic_increment_quota", {
    _principal_id: principalId,
    _period: period,
    _action: action,
    _cap: cap,
  });

  if (error) {
    console.error(
      `[entitlement] atomic_increment_quota RPC failed for ${action}:`,
      error.message
    );
    // Fail open for quota tracking errors. The alternative is blocking
    // users because of a transient DB issue, which is worse.
    return { allowed: true, currentCount: 0 };
  }

  // The RPC returns null when the cap was already reached.
  if (data === null) {
    // We do not know the exact count when denied; use the cap value.
    return { allowed: false, currentCount: cap };
  }

  return { allowed: true, currentCount: data as number };
}
