import "server-only";

import { MAX_REFERRAL_WEEKS } from "@/lib/referral/referralRules";
import { ensureReferralCode } from "./generateReferralCode";
import { loadReferralStanding } from "./loadReferralProgress";

/**
 * Returns the full referral summary for the referral page: the user's
 * referral code, share link, progress counts, and creator_access_until.
 *
 * Creates the user's referral code on first visit (ensureReferralCode): the
 * code is only ever shown here, so nothing needs it earlier.
 *
 * A plain server function, not a server action: its userId is trusted, and
 * only the referral page (which takes it from auth()) calls it.
 *
 * Tables: referral_codes (read/insert via ensureReferralCode),
 *         users, referrals, referral_reward_grants (one read via
 *         loadReferralStanding)
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
  // Creates the code on the user's first visit, the only place it is shown
  const codeResult = await ensureReferralCode(userId);
  if (!codeResult.success) {
    return { success: false, message: codeResult.message };
  }

  const standingResult = await loadReferralStanding(userId);
  if (!standingResult.success) {
    return { success: false, message: standingResult.message };
  }

  // A missing users row gets the same reply as a failed read.
  const standing = standingResult.standing;
  if (!standing) {
    console.error(
      `[getReferralSummary] No users row for ${userId}`,
    );
    return { success: false, message: "Failed to load referral access" };
  }

  return {
    success: true,
    code: codeResult.code,
    shareLink: `${origin}/?ref=${codeResult.code}`,
    towardNextWeek: standing.verifiedCount,
    weeksEarned: standing.weeksEarned,
    capReached: standing.weeksEarned >= MAX_REFERRAL_WEEKS,
    creatorAccessUntil: standing.creatorAccessUntil,
    totalVerified: standing.verifiedCount + standing.redeemedCount,
    totalRedeemed: standing.redeemedCount,
  };
}
