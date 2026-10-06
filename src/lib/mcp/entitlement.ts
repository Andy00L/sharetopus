import "server-only";

import { sql } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { currentQuotaPeriod } from "@/lib/mcp/_shared/currentQuotaPeriod";
import { type PlanTier, tierLabel, tierMeets } from "@/lib/types/plans";

import type { McpPrincipal } from "./auth/types";
import type { McpToolName } from "./toolNames";

/** Allow, or deny with the message the agent sees. */
export type EntitlementResult =
  | { mode: "allow" }
  | { mode: "deny"; reason: EntitlementDenyReason; detail: string };

type EntitlementDenyReason =
  | "no_subscription"
  | "plan_too_low"
  | "monthly_quota"
  | "platform_quota"
  | "infra_error";

/** Minimum plan per tool. MCP is a Creator feature, so every tool asks for Creator today. */
const ACTION_PLAN_GATE: Record<McpToolName, PlanTier> = {
  list_connections:       "creator",
  list_pinterest_boards:  "creator",
  list_posts:             "creator",
  list_billing_summary:   "creator",
  get_account_analytics:  "creator",
  attach_media_from_url:  "creator",
  request_upload_url:     "creator",
  publish_posts:          "creator",
  update_scheduled_posts: "creator",
  delete_scheduled_posts: "creator",
};

/**
 * Monthly call caps per tool and tier: a number caps it, 0 removes the tool
 * from the tier, null is unlimited. Tools without an entry are uncapped.
 */
const MONTHLY_CAPS: Partial<Record<McpToolName, Record<PlanTier, number | null>>> = {
  publish_posts:         { starter: 0, creator: 500, pro: null },
  request_upload_url:    { starter: 0, creator: 500, pro: null },
  attach_media_from_url: { starter: 0, creator: 500, pro: null },
};

/** The monthly cap of every capped tool on a plan, for list_billing_summary. */
export function monthlyCapsForPlan(plan: PlanTier): Record<string, number | null> {
  return Object.fromEntries(
    Object.entries(MONTHLY_CAPS).map(([toolName, capsByTier]) => [toolName, capsByTier[plan]]),
  );
}

/** Plan gate, then the atomic monthly quota increment. Runs before every tool call. */
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

function checkTierGate(
  principal: McpPrincipal,
  action: McpToolName,
): EntitlementResult {
  const required = ACTION_PLAN_GATE[action];
  if (tierMeets(principal.plan, required)) return { mode: "allow" };
  const planSentence =
    principal.plan === null
      ? "You do not have an active subscription."
      : `You are on the ${tierLabel(principal.plan)} plan.`;
  return {
    mode: "deny",
    reason: principal.plan === null ? "no_subscription" : "plan_too_low",
    detail: `"${action}" needs the ${tierLabel(required)} plan or higher. ${planSentence} Upgrade at https://sharetopus.com/#pricing.`,
  };
}

async function checkAndIncrementQuota(
  principal: McpPrincipal,
  action: McpToolName,
): Promise<EntitlementResult> {
  const caps = MONTHLY_CAPS[action];
  if (!caps) return { mode: "allow" };

  if (principal.plan === null) {
    return {
      mode: "deny",
      reason: "no_subscription",
      detail: `"${action}" needs an active subscription.`,
    };
  }

  const cap = caps[principal.plan];
  if (cap === 0) {
    return {
      mode: "deny",
      reason: "platform_quota",
      detail: `"${action}" is not available on the ${tierLabel(principal.plan)} plan.`,
    };
  }
  if (cap === null) return { mode: "allow" };

  const quotaResult = await incrementQuota(principal.principalId, action, cap);
  if (quotaResult.allowed) return { mode: "allow" };
  if (quotaResult.unavailable) {
    return {
      mode: "deny",
      reason: "infra_error",
      detail: `Quota check for "${action}" is temporarily unavailable. Retry in a moment.`,
    };
  }
  return {
    mode: "deny",
    reason: "monthly_quota",
    detail: `Monthly quota reached for "${action}": ${quotaResult.currentCount}/${cap} calls. It resets on the 1st.`,
  };
}

/**
 * atomic_increment_quota checks and increments in one statement, so two calls
 * at cap - 1 give one allow and one deny. It returns null when the cap is
 * already reached. A failed call fails closed: the caps bound paid usage.
 */
async function incrementQuota(
  principalId: string,
  action: McpToolName,
  cap: number,
): Promise<{ allowed: boolean; currentCount: number; unavailable?: boolean }> {
  const period = currentQuotaPeriod();

  const { data: quotaRows, error } = await runQuery(
    db.execute(
      sql`select public.atomic_increment_quota(${principalId}, ${period}::date, ${action}, ${cap}::integer) as new_count`,
    ),
  );

  if (error) {
    console.error(
      `[entitlement] atomic_increment_quota RPC failed for ${action}:`,
      error.message,
    );
    return { allowed: false, currentCount: 0, unavailable: true };
  }

  const newCount: unknown = quotaRows[0]?.new_count;
  if (newCount === null) {
    return { allowed: false, currentCount: cap };
  }
  if (typeof newCount !== "number") {
    console.error(`[entitlement] atomic_increment_quota returned no count for ${action}`);
    return { allowed: false, currentCount: 0, unavailable: true };
  }

  return { allowed: true, currentCount: newCount };
}
