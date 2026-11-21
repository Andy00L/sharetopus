import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { referral_reward_grants, referrals, users } from "@/db/schema";

export type ReferralStanding = {
  verifiedCount: number;
  redeemedCount: number;
  weeksEarned: number;
  creatorAccessUntil: string | null;
};

export type ReferralStandingResult =
  | { success: true; standing: ReferralStanding | null }
  | { success: false; message: string };

export async function loadReferralStanding(
  userId: string,
): Promise<ReferralStandingResult> {
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
