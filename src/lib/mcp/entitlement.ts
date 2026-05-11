import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import type { McpPrincipal } from "./auth";
import { type PlanTier, tierMeets, tierLabel } from "@/lib/types/plans";

/**
 * Result of an entitlement check. Tool handlers branch on `mode`.
 */
export type EntitlementResult =
  | { mode: "allow" }
  | { mode: "deny"; reason: EntitlementDenyReason; detail: string };

type EntitlementDenyReason =
  | "no_subscription"
  | "plan_too_low"
  | "monthly_quota"
  | "platform_quota"
  | "infra_error";

/**
 * Maps each MCP action to the minimum plan tier required.
 *
 * Read-only tools are available to any active subscriber.
 * Write tools require Starter+.
 * bulk_schedule and analytics require Creator+.
 * generate_post_draft requires Pro because it uses client-side sampling
 * and we want to gate the capability to paying users.
 */
const ACTION_PLAN_GATE: Record<string, PlanTier> = {
  // Read tools (free tier)
  list_connections: "free",
  list_scheduled_posts: "free",
  list_content_history: "free",
  list_billing_summary: "free",
  request_account_reauth_link: "free",
  list_pinterest_boards: "free",

  // Write tools (starter+)
  attach_media_from_url: "starter",
  request_upload_url: "starter",
  schedule_post: "starter",
  post_now: "starter",
  cancel_scheduled_posts: "starter",
  resume_scheduled_posts: "starter",
  reschedule_posts: "starter",
  delete_scheduled_posts: "starter",

  // Advanced tools (creator+)
  bulk_schedule: "creator",
  bulk_post_now: "creator",
  get_account_analytics: "creator",

  // AI tools (pro)
  generate_post_draft: "pro",
};

/**
 * Monthly quota caps per action per plan tier.
 * Only write actions that hit external APIs need caps.
 * null means unlimited.
 */
const MONTHLY_CAPS: Record<string, Record<PlanTier, number | null>> = {
  schedule_post: { free: 10, starter: 100, creator: 500, pro: null },
  post_now: { free: 0, starter: 100, creator: 500, pro: null },
  request_upload_url: { free: 0, starter: 100, creator: 500, pro: null },
  bulk_schedule: { free: 0, starter: 0, creator: 200, pro: null },
  bulk_post_now: { free: 0, starter: 0, creator: 500, pro: null },
  generate_post_draft: { free: 0, starter: 0, creator: 0, pro: 100 },
};

/**
 * Checks whether a principal is entitled to perform the given action.
 *
 * Runs on every MCP tool call. The plan tier is read from `principal.plan`,
 * which auth.ts populates via priceIdToTier on every request.
 *
 * Order of checks:
 *   1. Compare the principal's tier against the minimum for the action.
 *   2. If the action has a monthly cap, call atomic_increment_quota RPC.
 *
 * Tables read: usage_quotas (via RPC)
 * Tables written: usage_quotas (via RPC, atomic increment)
 *
 * Called by: every tool handler before doing any real work
 */
export async function entitlementFor(
  principal: McpPrincipal,
  action: string
): Promise<EntitlementResult> {
  const tierGate = checkTierGate(principal, action);
  if (tierGate.mode === "deny") return tierGate;

  const quota = await checkAndIncrementQuota(principal, action);
  if (quota.mode === "deny") return quota;

  return { mode: "allow" };
}

function checkTierGate(
  principal: McpPrincipal,
  action: string
): EntitlementResult {
  const required = ACTION_PLAN_GATE[action] ?? "starter";
  if (tierMeets(principal.plan, required)) return { mode: "allow" };
  return {
    mode: "deny",
    reason: principal.plan === "free" ? "no_subscription" : "plan_too_low",
    detail: buildTierDenyMessage(action, required, principal.plan),
  };
}

function buildTierDenyMessage(
  action: string,
  required: PlanTier,
  actual: PlanTier
): string {
  if (actual === "free") {
    return `Action "${action}" requires the ${tierLabel(required)} ` +
           `plan or higher. You do not have an active subscription.`;
  }
  return `Action "${action}" requires the ${tierLabel(required)} ` +
         `plan or higher. You are on the ${tierLabel(actual)} plan.`;
}

/**
 * Checks and increments the monthly quota for the given action.
 * Returns an allow or deny result matching EntitlementResult.
 */
async function checkAndIncrementQuota(
  principal: McpPrincipal,
  action: string
): Promise<EntitlementResult> {
  const caps = MONTHLY_CAPS[action];
  if (!caps) return { mode: "allow" };

  const cap = caps[principal.plan];
  if (cap === 0) {
    return {
      mode: "deny",
      reason: "platform_quota",
      detail: `Action "${action}" is not available on the ${tierLabel(principal.plan)} plan.`,
    };
  }
  if (cap === null || cap === undefined) return { mode: "allow" };

  const quotaResult = await incrementQuota(
    principal.principalId,
    action,
    cap
  );
  if (!quotaResult.allowed) {
    return {
      mode: "deny",
      reason: "monthly_quota",
      detail: `Monthly quota exceeded for "${action}". Used ${quotaResult.currentCount}/${cap}. Resets next month.`,
    };
  }

  return { mode: "allow" };
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
 *
 * The `_period` RPC parameter is typed `date` in Postgres, so the value
 * must be a valid YYYY-MM-DD string (first of month, UTC).
 */
async function incrementQuota(
  principalId: string,
  action: string,
  cap: number
): Promise<{ allowed: boolean; currentCount: number }> {
  const now = new Date();
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`; // YYYY-MM-DD (first of month, matches RPC _period date param)

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
