import "server-only";

import { eq } from "drizzle-orm";

import { db, isUniqueViolation, runQuery } from "@/db/client";
import { referral_codes, referrals, users } from "@/db/schema";

export type ReferralSignupOutcome =
  | { kind: "recorded"; referrerId: string }
  | { kind: "not_attributed"; reason: "unknown_code" | "self_referral" | "user_missing" }
  | { kind: "failed"; message: string };

/**
 * Clerk verifies the email before the user exists, so the referral is
 * inserted directly as "verified". A referral already recorded for the user
 * counts as recorded, so a retry still reaches the reward grant.
 */
export async function recordReferralOnSignup(params: {
  newUserId: string;
  referralCode: string;
}): Promise<ReferralSignupOutcome> {
  const { newUserId, referralCode } = params;
  const { data: codeRows, error: codeError } = await runQuery(
    db
      .select({ user_id: referral_codes.user_id, email: users.email })
      .from(referral_codes)
      .innerJoin(users, eq(users.id, referral_codes.user_id))
      .where(eq(referral_codes.code, referralCode))
      .limit(1),
  );
  if (codeError) {
    return { kind: "failed", message: `Failed to resolve referral code: ${codeError.message}` };
  }
  const codeRow = codeRows[0];
  if (!codeRow) {
    console.warn(`[recordReferralOnSignup] Unknown referral code "${referralCode}" for user ${newUserId}`);
    return { kind: "not_attributed", reason: "unknown_code" };
  }
  const referrerId = codeRow.user_id;

  const { data: newUserRows, error: newUserError } = await runQuery(
    db.select({ email: users.email }).from(users).where(eq(users.id, newUserId)).limit(1),
  );
  if (newUserError) {
    return { kind: "failed", message: `Failed to read the new user: ${newUserError.message}` };
  }
  const newUser = newUserRows[0];
  if (!newUser) {
    console.warn(`[recordReferralOnSignup] User ${newUserId} no longer exists`);
    return { kind: "not_attributed", reason: "user_missing" };
  }

  const isSelfReferral =
    referrerId === newUserId || codeRow.email.toLowerCase() === newUser.email.toLowerCase();
  if (isSelfReferral) {
    console.warn(`[recordReferralOnSignup] Self-referral blocked for ${newUserId}`);
    return { kind: "not_attributed", reason: "self_referral" };
  }

  const { error: insertError } = await runQuery(
    db.insert(referrals).values({
      referrer_id: referrerId,
      referred_id: newUserId,
      status: "verified",
      verified_at: new Date().toISOString(),
    }),
  );
  if (insertError && !isUniqueViolation(insertError)) {
    return { kind: "failed", message: `Failed to record referral: ${insertError.message}` };
  }

  console.log(`[recordReferralOnSignup] Referral recorded: ${referrerId} -> ${newUserId}`);
  return { kind: "recorded", referrerId };
}
