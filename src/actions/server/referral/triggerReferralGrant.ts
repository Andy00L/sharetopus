import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
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
 * Cache invalidation after a successful grant ensures the referrer's
 * new Creator access is visible on the next web request to the same
 * Vercel instance (other instances catch up at the 60s TTL).
 *
 * Called by: recordReferralOnSignup (after a new referral is verified)
 * Tables touched (via RPC): referrals, referral_reward_grants, users
 */
export async function triggerReferralGrant(
  referrerId: string,
): Promise<
  { success: true; weeksGranted: number } | { success: false; message: string }
> {
  const { data: weeksGranted, error: rpcError } = await adminSupabase.rpc(
    "grant_referral_rewards",
    { p_referrer_id: referrerId },
  );

  if (rpcError) {
    console.error(
      `[triggerReferralGrant] RPC failed for referrer ${referrerId}:`,
      rpcError.message,
    );
    return { success: false, message: "Reward grant RPC failed" };
  }

  const grantedWeeks = typeof weeksGranted === "number" ? weeksGranted : 0;

  if (grantedWeeks > 0) {
    // Invalidate the subscription cache so the referrer's new access
    // is visible immediately on web (same function the Stripe webhook uses).
    invalidateCachedSubscription(referrerId);
    console.log(
      `[triggerReferralGrant] Granted ${grantedWeeks} week(s) to referrer ${referrerId}, cache invalidated`,
    );
  }

  return { success: true, weeksGranted: grantedWeeks };
}
