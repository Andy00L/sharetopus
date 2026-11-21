"use server";

import { auth } from "@clerk/nextjs/server";

import { loadReferralStanding } from "@/lib/referral/loadReferralStanding";
import { MAX_REFERRAL_WEEKS } from "@/lib/referral/referralRules";

export type ReferralProgressResult =
  | {
      success: true;
      towardNextWeek: number;
      weeksEarned: number;
      capReached: boolean;
    }
  | { success: false; message: string };

export async function getReferralProgress(): Promise<ReferralProgressResult> {
  const { userId } = await auth();
  if (!userId) {
    return { success: false, message: "Not signed in" };
  }

  const standingResult = await loadReferralStanding(userId);
  if (!standingResult.success) return standingResult;

  const verifiedCount = standingResult.standing?.verifiedCount ?? 0;
  const weeksEarned = standingResult.standing?.weeksEarned ?? 0;
  return {
    success: true,
    towardNextWeek: verifiedCount,
    weeksEarned,
    capReached: weeksEarned >= MAX_REFERRAL_WEEKS,
  };
}
