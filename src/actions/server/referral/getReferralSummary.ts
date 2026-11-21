import "server-only";

import { auth } from "@clerk/nextjs/server";

import { loadSettledReferralStanding } from "@/lib/referral/loadReferralStanding";
import { MAX_REFERRAL_WEEKS } from "@/lib/referral/referralRules";
import { ensureReferralCode } from "./generateReferralCode";

export async function getReferralSummary(
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
  const { userId } = await auth();
  if (!userId) {
    return { success: false, message: "Not signed in" };
  }

  const codeResult = await ensureReferralCode(userId);
  if (!codeResult.success) {
    return { success: false, message: codeResult.message };
  }

  const standingResult = await loadSettledReferralStanding(userId);
  if (!standingResult.success) {
    return { success: false, message: standingResult.message };
  }

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
