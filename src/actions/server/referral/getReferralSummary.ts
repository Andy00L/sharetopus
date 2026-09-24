import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { referrals, users } from "@/db/schema";
import { ensureReferralCode } from "./generateReferralCode";
import { loadReferralProgress } from "./loadReferralProgress";

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
 *         referrals (read via loadReferralProgress),
 *         referral_reward_grants (read via loadReferralProgress),
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
  // Creates the code on the user's first visit, the only place it is shown
  const codeResult = await ensureReferralCode(userId);
  if (!codeResult.success) {
    return { success: false, message: codeResult.message };
  }

  // Get progress toward next week and total weeks earned
  const progressResult = await loadReferralProgress(userId);
  if (!progressResult.success) {
    return { success: false, message: progressResult.message };
  }

  // Count total verified referrals (verified + redeemed)
  const { data: verifiedCount, error: verifiedError } = await runQuery(
    db.$count(
      referrals,
      and(
        eq(referrals.referrer_id, userId),
        inArray(referrals.status, ["verified", "redeemed"]),
      ),
    ),
  );

  if (verifiedError) {
    console.error(
      `[getReferralSummary] Failed to count referrals for ${userId}:`,
      verifiedError.message,
    );
    return { success: false, message: "Failed to load referral counts" };
  }

  // Count redeemed referrals separately
  const { data: redeemedCount, error: redeemedError } = await runQuery(
    db.$count(
      referrals,
      and(eq(referrals.referrer_id, userId), eq(referrals.status, "redeemed")),
    ),
  );

  if (redeemedError) {
    console.error(
      `[getReferralSummary] Failed to count redeemed referrals for ${userId}:`,
      redeemedError.message,
    );
    return { success: false, message: "Failed to load redeemed count" };
  }

  // Read creator_access_until for display
  const { data: userRows, error: userError } = await runQuery(
    db
      .select({ creator_access_until: users.creator_access_until })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
  );

  // A missing users row gets the same reply as a failed read.
  const userData = userRows?.[0];
  if (userError || !userData) {
    console.error(
      `[getReferralSummary] Failed to read creator_access_until for ${userId}:`,
      userError?.message ?? "no user row",
    );
    return { success: false, message: "Failed to load referral access" };
  }

  const creatorAccessUntil = userData.creator_access_until;

  return {
    success: true,
    code: codeResult.code,
    shareLink: `${origin}/?ref=${codeResult.code}`,
    towardNextWeek: progressResult.towardNextWeek,
    weeksEarned: progressResult.weeksEarned,
    capReached: progressResult.capReached,
    creatorAccessUntil,
    totalVerified: verifiedCount,
    totalRedeemed: redeemedCount,
  };
}
