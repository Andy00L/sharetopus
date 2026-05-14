import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { currentQuotaPeriod } from "@/lib/mcp/_shared/currentQuotaPeriod";
import { type PlanTier, tierLabel, tierMeets } from "@/lib/types/plans";

import type { McpPrincipal } from "./auth";
import type { McpToolName } from "./toolNames";

/**
 * Result of an entitlement check. Tool handlers branch on `mode`:
 *   - "allow": proceed with the action
 *   - "deny": short-circuit with the audit status derived from `reason`
 *
 * `detail` is the human-facing message the tool surfaces to the agent.
 */
export type EntitlementResult =
  | { mode: "allow" }
  | { mode: "deny"; reason: EntitlementDenyReason; detail: string };

/**
 * Why a request was denied. The HOF wrapper in withMcpTool maps:
 *   - "platform_quota" / "monthly_quota" -> audit status "quota_exceeded"
 *   - "no_subscription" / "plan_too_low" / "infra_error" -> "denied"
 */
type EntitlementDenyReason =
  | "no_subscription"
  | "plan_too_low"
  | "monthly_quota"
  | "platform_quota"
  | "infra_error";

/**
 * Minimum plan tier required to invoke each MCP tool.
 *
 * Typed as `Record<McpToolName, PlanTier>` so the TypeScript compiler
 * forces every tool name in MCP_TOOL_NAMES to have an entry. Adding a
 * new tool name without adding a tier here is a build error, which is
 * exactly the safety net we want.
 *
 * Tier policy:
 *   - "free": read-only metadata tools (list_*, request_account_reauth_link)
 *   - "starter": write tools that hit external APIs (schedule, post, media)
 *   - "creator": batch tools and analytics
 *   - "pro": AI-assisted draft generation (uses client-side sampling)
 */
const ACTION_PLAN_GATE: Record<McpToolName, PlanTier> = {
  list_connections: "free",
  list_pinterest_boards: "free",
  list_scheduled_posts: "free",
  list_content_history: "free",
  list_billing_summary: "free",
  request_account_reauth_link: "free",
  attach_media_from_url: "starter",
  request_upload_url: "starter",
  schedule_post: "starter",
  post_now: "starter",
  cancel_scheduled_posts: "starter",
  resume_scheduled_posts: "starter",
  reschedule_posts: "starter",
  delete_scheduled_posts: "starter",
  bulk_schedule: "creator",
  bulk_post_now: "creator",
  get_account_analytics: "creator",
  generate_post_draft: "pro",
};

/**
 * Per-tool monthly quota caps, keyed first by tool name then by plan tier.
 *
 * Typed as `Partial<Record<McpToolName, ...>>` because only tools that
 * touch external APIs or sample Claude need explicit caps. Read tools
 * and admin-style tools are uncapped. A missing entry == no cap.
 *
 * Semantics of the inner cap value:
 *   - `number > 0`: monthly cap. Enforced atomically via
 *     atomic_increment_quota RPC.
 *   - `0`: tool not available on this tier (returns "platform_quota"
 *     even before the RPC runs).
 *   - `null`: unlimited on this tier.
 *
 * When adjusting these numbers, remember the RPC counts attempts AFTER
 * the tier gate passes, so increasing a tier's cap retroactively does
 * not invalidate already-rejected calls.
 */
const MONTHLY_CAPS: Partial<
  Record<McpToolName, Record<PlanTier, number | null>>
> = {
  schedule_post: { free: 10, starter: 100, creator: 500, pro: null },
  post_now: { free: 0, starter: 100, creator: 500, pro: null },
  request_upload_url: { free: 0, starter: 100, creator: 500, pro: null },
  attach_media_from_url: { free: 0, starter: 100, creator: 500, pro: null },
  bulk_schedule: { free: 0, starter: 0, creator: 200, pro: null },
  bulk_post_now: { free: 0, starter: 0, creator: 500, pro: null },
  generate_post_draft: { free: 0, starter: 0, creator: 0, pro: 100 },
};

/**
 * Checks whether a principal is entitled to perform the given action.
 *
 * Runs on every MCP tool call (via the withMcpTool HOF). The plan tier
 * is read from `principal.plan`, which the auth dispatcher populates via
 * priceIdToTier on every request from the live stripe_subscriptions row.
 *
 * Order of checks:
 *   1. Tier gate: compare `principal.plan` to ACTION_PLAN_GATE[action].
 *   2. Quota gate: if MONTHLY_CAPS has an entry, call the atomic
 *      increment RPC. The RPC handles the increment-and-check inside a
 *      single SQL statement so concurrent requests cannot exceed the cap.
 *
 * `action` is typed as McpToolName so callers cannot pass an arbitrary
 * string and silently miss a gate.
 *
 * Tables read:  usage_quotas (via RPC)
 * Tables written: usage_quotas (via RPC, atomic increment)
 *
 * Called by: withMcpTool wrapper, before any business logic runs.
 */
export async function entitlementFor(
  principal: McpPrincipal,
  action: McpToolName,
): Promise<EntitlementResult> {
  const tierGate = checkTierGate(principal, action);
  if (tierGate.mode === "deny") return tierGate;

  const quota = await checkAndIncrementQuota(principal, action);
  if (quota.mode === "deny") return quota;

  return { mode: "allow" };
}

/**
 * Pure tier comparison. No DB call. Returns deny when the principal's
 * plan ranks lower than ACTION_PLAN_GATE[action]. Distinguishes free-tier
 * (no_subscription) from paid-but-low-tier (plan_too_low) so the message
 * surfaced to the agent can suggest the right next step.
 */
function checkTierGate(
  principal: McpPrincipal,
  action: McpToolName,
): EntitlementResult {
  const required = ACTION_PLAN_GATE[action];
  if (tierMeets(principal.plan, required)) return { mode: "allow" };
  return {
    mode: "deny",
    reason: principal.plan === "free" ? "no_subscription" : "plan_too_low",
    detail: buildTierDenyMessage(action, required, principal.plan),
  };
}

/**
 * Builds the user-facing string returned in EntitlementResult.detail
 * when a tier gate fires. Two variants: free vs paid-but-too-low, so
 * the upgrade prompt makes sense in context.
 */
function buildTierDenyMessage(
  action: McpToolName,
  required: PlanTier,
  actual: PlanTier,
): string {
  if (actual === "free") {
    return (
      `Action "${action}" requires the ${tierLabel(required)} ` +
      `plan or higher. You do not have an active subscription.`
    );
  }
  return (
    `Action "${action}" requires the ${tierLabel(required)} ` +
    `plan or higher. You are on the ${tierLabel(actual)} plan.`
  );
}

/**
 * Runs the per-tool monthly quota gate. Three outcomes:
 *   - Tool has no MONTHLY_CAPS entry: allow.
 *   - Cap is 0 for this tier: deny with "platform_quota" (the tool
 *     is gated out of the tier entirely, no RPC call needed).
 *   - Cap is null: allow (unlimited on this tier).
 *   - Cap is a positive number: call atomic_increment_quota and deny
 *     with "monthly_quota" if the RPC reports the cap is reached.
 */
async function checkAndIncrementQuota(
  principal: McpPrincipal,
  action: McpToolName,
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

  const quotaResult = await incrementQuota(principal.principalId, action, cap);
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
 * Atomically increments the usage counter for a principal+action pair
 * and returns whether the caller is still within the cap.
 *
 * Calls the `atomic_increment_quota` Postgres function which performs
 * the check-and-increment in a single statement, closing the race
 * window that existed in the old read-then-upsert approach. Two
 * concurrent requests at cap-1 will produce one allow and one deny,
 * never two allows.
 *
 * Return semantics:
 *   - `null` from the RPC means the cap was already reached; the call
 *     did NOT increment. Returned as `{ allowed: false, currentCount: cap }`
 *     so the caller can build the deny message with the cap value.
 *   - Any non-null value is the new count after increment.
 *
 * The `_period` RPC parameter is typed `date` in Postgres, so the value
 * must be a valid YYYY-MM-DD string. currentQuotaPeriod() always
 * returns the first of the current month in UTC.
 *
 * Failure mode: on RPC error we FAIL OPEN and let the call proceed.
 * Blocking paying users because of a transient DB hiccup is worse
 * than letting a single request slip past the cap. The error is
 * surfaced in logs for forensic review.
 */
async function incrementQuota(
  principalId: string,
  action: McpToolName,
  cap: number,
): Promise<{ allowed: boolean; currentCount: number }> {
  const period = currentQuotaPeriod();

  const { data, error } = await adminSupabase.rpc("atomic_increment_quota", {
    _principal_id: principalId,
    _period: period,
    _action: action,
    _cap: cap,
  });

  if (error) {
    console.error(
      `[entitlement] atomic_increment_quota RPC failed for ${action}:`,
      error.message,
    );
    return { allowed: true, currentCount: 0 };
  }

  if (data === null) {
    return { allowed: false, currentCount: cap };
  }

  return { allowed: true, currentCount: data as number };
}
