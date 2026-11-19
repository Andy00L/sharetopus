import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { referral_reward_grants, referrals, users } from "@/db/schema";
import { MAX_REFERRAL_WEEKS } from "@/lib/referral/referralRules";

export type ReferralProgressResult =
  | {
      success: true;
      towardNextWeek: number;
      weeksEarned: number;
      capReached: boolean;
    }
  | { success: false; message: string };

/** One user's referral counts and banked access, read in one statement. */
export type ReferralStanding = {
  verifiedCount: number;
  redeemedCount: number;
  weeksEarned: number;
  creatorAccessUntil: string | null;
};

/**
 * The user's verified and redeemed referral counts, weeks earned and
 * creator_access_until in one round trip (scalar subqueries on the users
 * row). `standing` is null when the user has no users row.
 *
 * Called by: loadReferralProgress, getReferralSummary
 */
export async function loadReferralStanding(
  userId: string,
): Promise<
  | { success: true; standing: ReferralStanding | null }
  | { success: false; message: string }
> {
  const { data: standingRows, error } = await runQuery(
    db
      .select({
        verifiedCount: db.$count(
          referrals,
          and(eq(referrals.referrer_id, userId), eq(referrals.status, "verified")),
        ),
        redeemedCount: db.$count(
          referrals,
          and(eq(referrals.referrer_id, userId), eq(referrals.status, "redeemed")),
        ),
        weeksEarned: sql`(select coalesce(sum(${referral_reward_grants.weeks_granted}), 0)::int from ${referral_reward_grants} where ${referral_reward_grants.user_id} = ${userId})`.mapWith(Number),
        creatorAccessUntil: users.creator_access_until,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
  );

  if (error) {
    console.error(
      `[loadReferralStanding] Failed to load referral standing for ${userId}:`,
      error.message,
    );
    return { success: false, message: "Failed to load referral progress" };
  }
  return { success: true, standing: standingRows[0] ?? null };
}

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
 * Tables: users, referrals, referral_reward_grants (one read)
 * Called by: getReferralProgress (sidebar badge)
 */
export async function loadReferralProgress(userId: string): Promise<ReferralProgressResult> {
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
