import "server-only";

import { eq } from "drizzle-orm";

import { db, isUniqueViolation, runQuery } from "@/db/client";
import { referral_codes, referrals, users } from "@/db/schema";
import { triggerReferralGrant } from "@/lib/referral/triggerReferralGrant";

/**
 * Clerk verifies the email before the user exists, so the referral is
 * inserted directly as "verified".
 */
export async function recordReferralOnSignup(params: {
  newUserId: string;
  newUserEmail: string;
  referralCode: string;
}): Promise<{ success: true } | { success: false; message: string }> {
  const { newUserId, newUserEmail, referralCode } = params;
  const { data: codeRows, error: codeError } = await runQuery(
    db
      .select({ user_id: referral_codes.user_id, email: users.email })
      .from(referral_codes)
      .innerJoin(users, eq(users.id, referral_codes.user_id))
      .where(eq(referral_codes.code, referralCode))
      .limit(1),
  );

  if (codeError) {
    console.error(
      `[recordReferralOnSignup] Failed to resolve code "${referralCode}":`,
      codeError.message,
    );
    return { success: false, message: "Failed to resolve referral code" };
  }

  const codeRow = codeRows[0];
  if (!codeRow) {
    console.warn(
      `[recordReferralOnSignup] Unknown referral code "${referralCode}" for user ${newUserId}`,
    );
    return { success: false, message: "Unknown referral code" };
  }

  const referrerId = codeRow.user_id;

  if (referrerId === newUserId) {
    console.warn(
      `[recordReferralOnSignup] Self-referral blocked (same ID) for ${newUserId}`,
    );
    return { success: false, message: "Self-referral not allowed" };
  }

  if (codeRow.email.toLowerCase() === newUserEmail.toLowerCase()) {
    console.warn(
      `[recordReferralOnSignup] Self-referral blocked (same email) for ${newUserId}`,
    );
    return { success: false, message: "Self-referral not allowed" };
  }

  const { error: insertError } = await runQuery(
    db.insert(referrals).values({
      referrer_id: referrerId,
      referred_id: newUserId,
      status: "verified",
      verified_at: new Date().toISOString(),
    }),
  );

  if (insertError) {
    if (isUniqueViolation(insertError)) {
      console.warn(
        `[recordReferralOnSignup] Duplicate referral for ${newUserId}, already attributed`,
      );
      return { success: true };
    }

    console.error(
      `[recordReferralOnSignup] Insert failed for ${newUserId}:`,
      insertError.message,
    );
    return { success: false, message: "Failed to record referral" };
  }

  console.log(
    `[recordReferralOnSignup] Referral recorded: ${referrerId} -> ${newUserId}`,
  );

  const grantResult = await triggerReferralGrant(referrerId);
  if (!grantResult.success) {
    console.error(
      `[recordReferralOnSignup] Grant trigger failed for referrer ${referrerId}: ${grantResult.message}`,
    );
    return {
      success: false,
      message: "Referral recorded, reward grant failed; the referrer's next visit retries it",
    };
  }
  if (grantResult.weeksGranted > 0) {
    console.log(
      `[recordReferralOnSignup] Referrer ${referrerId} earned ${grantResult.weeksGranted} week(s) of Creator access`,
    );
  }

  return { success: true };
}
