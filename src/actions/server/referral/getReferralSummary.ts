"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { ensureReferralCode } from "./generateReferralCode";
import { getReferralProgress } from "./getReferralProgress";

/**
 * Returns the full referral summary for the referral page: the user's
 * referral code, share link, progress counts, and creator_access_until.
 *
 * Calls ensureReferralCode as a lazy fallback in case the eager generation
 * at signup was skipped (e.g., ensureUserExists errored on that step).
 *
 * Tables: referral_codes (read/insert via ensureReferralCode),
 *         referrals (read via getReferralProgress),
 *         referral_reward_grants (read via getReferralProgress),
 *         users (read for creator_access_until)
 * Called by: referral page server component
 */
export async function getReferralSummary(
  userId: string,
  origin: string,
): Promise<
  | {
      success: true;
      code: string;
      shareLink: string;
      towardNextWeek: number;
      weeksEarned: number;
      capReached: boolean;
      creatorAccessUntil: string | null;
      totalVerified: number;
      totalRedeemed: number;
    }
  | { success: false; message: string }
> {
  // Ensure the user has a referral code (lazy fallback)
  const codeResult = await ensureReferralCode(userId);
  if (!codeResult.success) {
    return { success: false, message: codeResult.message };
  }

  // Get progress toward next week and total weeks earned
  const progressResult = await getReferralProgress(userId);
  if (!progressResult.success) {
    return { success: false, message: progressResult.message };
  }

  // Count total verified referrals (verified + redeemed)
  const { count: verifiedCount, error: verifiedError } = await adminSupabase
    .from("referrals")
    .select("id", { count: "exact", head: true })
    .eq("referrer_id", userId)
    .in("status", ["verified", "redeemed"]);

  if (verifiedError) {
    console.error(
      `[getReferralSummary] Failed to count referrals for ${userId}:`,
      verifiedError.message,
    );
    return { success: false, message: "Failed to load referral counts" };
  }

  // Count redeemed referrals separately
  const { count: redeemedCount, error: redeemedError } = await adminSupabase
    .from("referrals")
    .select("id", { count: "exact", head: true })
    .eq("referrer_id", userId)
    .eq("status", "redeemed");

  if (redeemedError) {
    console.error(
      `[getReferralSummary] Failed to count redeemed referrals for ${userId}:`,
      redeemedError.message,
    );
    return { success: false, message: "Failed to load redeemed count" };
  }

  // Read creator_access_until for display
  const { data: userData } = await adminSupabase
    .from("users")
    .select("creator_access_until")
    .eq("id", userId)
    .single();

  const creatorAccessUntil = userData?.creator_access_until ?? null;

  return {
    success: true,
    code: codeResult.code,
    shareLink: `${origin}/?ref=${codeResult.code}`,
    towardNextWeek: progressResult.towardNextWeek,
    weeksEarned: progressResult.weeksEarned,
    capReached: progressResult.capReached,
    creatorAccessUntil,
    totalVerified: verifiedCount ?? 0,
    totalRedeemed: redeemedCount ?? 0,
  };
}
