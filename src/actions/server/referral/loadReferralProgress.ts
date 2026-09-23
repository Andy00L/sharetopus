import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { MAX_REFERRAL_WEEKS } from "@/lib/referral/referralRules";

export type ReferralProgressResult =
  | {
      success: true;
      towardNextWeek: number;
      weeksEarned: number;
      capReached: boolean;
    }
  | { success: false; message: string };

/**
 * Referral progress for one user: verified referrals counting toward the
 * next free week, total weeks earned, and whether the lifetime cap is
 * reached.
 *
 * The count is derived from the referrals table: verified referrals that
 * have NOT yet been redeemed count toward the next week. The grant function
 * redeems them in batches, so towardNextWeek stays below
 * REFERRALS_PER_FREE_WEEK unless the cap stopped redeeming.
 *
 * Server-only on purpose: the userId is trusted here. Client code reaches it
 * through the getReferralProgress action, which takes the user from the
 * session.
 *
 * Tables: referrals (read), referral_reward_grants (read)
 * Called by: getReferralProgress (sidebar badge), getReferralSummary (referral page)
 */
export async function loadReferralProgress(userId: string): Promise<ReferralProgressResult> {
  const { count: verifiedCount, error: verifiedError } = await adminSupabase
    .from("referrals")
    .select("id", { count: "exact", head: true })
    .eq("referrer_id", userId)
    .eq("status", "verified");

  if (verifiedError) {
    console.error(
      `[loadReferralProgress] Failed to count verified referrals for ${userId}:`,
      verifiedError.message,
    );
    return { success: false, message: "Failed to load referral progress" };
  }

  const { data: grantRows, error: grantsError } = await adminSupabase
    .from("referral_reward_grants")
    .select("weeks_granted")
    .eq("user_id", userId);

  if (grantsError) {
    console.error(
      `[loadReferralProgress] Failed to load grants for ${userId}:`,
      grantsError.message,
    );
    return { success: false, message: "Failed to load referral grants" };
  }

  const weeksEarned = (grantRows ?? []).reduce(
    (sum, row) => sum + row.weeks_granted,
    0,
  );

  return {
    success: true,
    towardNextWeek: verifiedCount ?? 0,
    weeksEarned,
    capReached: weeksEarned >= MAX_REFERRAL_WEEKS,
  };
}
