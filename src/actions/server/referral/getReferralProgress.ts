"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";

/**
 * Returns the referral progress for a user: how many verified referrals
 * count toward the next free week, total weeks earned, and whether the
 * lifetime cap has been reached.
 *
 * Used by the sidebar badge (NavReferral) and the referral page.
 *
 * The count is derived from the referrals table: verified referrals that
 * have NOT yet been redeemed count toward the next week. The RPC redeems
 * them in batches of 3, so towardNextWeek is always 0-2.
 *
 * Tables: referrals (read), referral_reward_grants (read)
 * Called by: NavReferral (sidebar badge), referral page
 */
export async function getReferralProgress(userId: string): Promise<
  | {
      success: true;
      towardNextWeek: number;
      weeksEarned: number;
      capReached: boolean;
    }
  | { success: false; message: string }
> {
  // Count verified (not yet redeemed) referrals for this user
  const { count: verifiedCount, error: verifiedError } = await adminSupabase
    .from("referrals")
    .select("id", { count: "exact", head: true })
    .eq("referrer_id", userId)
    .eq("status", "verified");

  if (verifiedError) {
    console.error(
      `[getReferralProgress] Failed to count verified referrals for ${userId}:`,
      verifiedError.message,
    );
    return { success: false, message: "Failed to load referral progress" };
  }

  // Sum total weeks granted from referral_reward_grants
  const { data: grantRows, error: grantsError } = await adminSupabase
    .from("referral_reward_grants")
    .select("weeks_granted")
    .eq("user_id", userId);

  if (grantsError) {
    console.error(
      `[getReferralProgress] Failed to load grants for ${userId}:`,
      grantsError.message,
    );
    return { success: false, message: "Failed to load referral grants" };
  }

  const weeksEarned = (grantRows ?? []).reduce(
    (sum, row) => sum + row.weeks_granted,
    0,
  );

  // Lifetime cap: 5 weeks (15 referrals redeemed). The RPC enforces the
  // cap, but we report it in the UI so users know.
  const capReached = weeksEarned >= 5;

  // Verified but not yet redeemed referrals count toward the next week.
  // After the RPC redeems a batch of 3, those flip to "redeemed", so
  // verifiedCount is always 0, 1, or 2 (unless the cap is reached and
  // the RPC stopped redeeming).
  const towardNextWeek = verifiedCount ?? 0;

  return {
    success: true,
    towardNextWeek,
    weeksEarned,
    capReached,
  };
}
