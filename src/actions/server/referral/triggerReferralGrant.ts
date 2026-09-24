import "server-only";

import { sql } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { invalidateCachedSubscription } from "@/lib/mcp/auth/resolvers/subscriptionCache";

/**
 * Calls the grant_referral_rewards RPC for a referrer and invalidates
 * the subscription cache if weeks were granted.
 *
 * The RPC owns ALL reward logic: counting verified referrals, checking
 * the lifetime cap (15 referrals / 5 weeks), atomically updating
 * creator_access_until (banking past the current subscription end),
 * and marking referrals as redeemed. This wrapper does NOT mutate
 * referral status or creator_access_until itself.
 *
 * The web gate (checkActiveSubscription) reads creator_access_until from
 * Postgres on every request, so the web sees a grant at once. Only the MCP
 * gate caches plans: invalidation clears this instance's entry, and other
 * instances catch up at the 60s TTL.
 *
 * Called by: recordReferralOnSignup (after a new referral is verified)
 * Tables touched (via RPC): referrals, referral_reward_grants, users
 */
export async function triggerReferralGrant(
  referrerId: string,
): Promise<
  { success: true; weeksGranted: number } | { success: false; message: string }
> {
  const { data: grantRows, error: rpcError } = await runQuery(
    db.execute(
      sql`select public.grant_referral_rewards(${referrerId}) as weeks_granted`,
    ),
  );

  if (rpcError) {
    console.error(
      `[triggerReferralGrant] RPC failed for referrer ${referrerId}:`,
      rpcError.message,
    );
    return { success: false, message: "Reward grant RPC failed" };
  }

  // The function returns int4, which db.execute hands back as a number.
  const weeksGranted: unknown = grantRows[0]?.weeks_granted;
  const grantedWeeks = typeof weeksGranted === "number" ? weeksGranted : 0;

  if (grantedWeeks > 0) {
    // Invalidate the MCP subscription cache so the new access applies to MCP
    // calls on this instance (same function the Stripe webhook uses).
    invalidateCachedSubscription(referrerId);
    console.log(
      `[triggerReferralGrant] Granted ${grantedWeeks} week(s) to referrer ${referrerId}, cache invalidated`,
    );
  }

  return { success: true, weeksGranted: grantedWeeks };
}
