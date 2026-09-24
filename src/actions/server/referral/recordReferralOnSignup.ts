import "server-only";

import { eq } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { referral_codes, referrals, users } from "@/db/schema";
import { triggerReferralGrant } from "./triggerReferralGrant";

/**
 * Records a referral for a newly created user, then asks the grant function
 * whether the referrer has earned a free week.
 *
 * The referral code is passed in: the caller reads the attribution cookie
 * while the page renders, and this runs afterwards inside after(), where
 * request cookies are unavailable. It never writes cookies. Next.js throws
 * on a cookie write during a Server Component render, and the old cookie
 * cleanup here did exactly that, so every grant was silently skipped. The
 * UNIQUE constraint on referrals.referred_id already makes attribution
 * one-time, so the cookie is left to expire.
 *
 * Clerk verifies the email before the user exists, so the referral is
 * inserted directly as "verified".
 *
 * Best-effort: failures are logged and returned as values; it never blocks
 * user creation.
 *
 * Called by: ensureUserExists, on FIRST user creation only.
 * Tables: referral_codes (read), referrals (insert), users (read)
 * Side effects: may call triggerReferralGrant (RPC + cache invalidation)
 */
export async function recordReferralOnSignup(params: {
  newUserId: string;
  newUserEmail: string;
  referralCode: string;
}): Promise<{ success: true } | { success: false; message: string }> {
  const { newUserId, newUserEmail, referralCode } = params;
  try {
    const { data: codeRows, error: codeError } = await runQuery(
      db
        .select({ user_id: referral_codes.user_id })
        .from(referral_codes)
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

    const { data: referrerUserRows, error: referrerError } = await runQuery(
      db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, referrerId))
        .limit(1),
    );

    // Without the referrer's email the self-referral check cannot run, and
    // recording the referral anyway let a second account of the referrer
    // earn the reward. The attribution is dropped instead.
    if (referrerError) {
      console.error(
        `[recordReferralOnSignup] Referrer lookup failed for ${referrerId}:`,
        referrerError.message,
      );
      return { success: false, message: "Failed to verify the referrer" };
    }

    const referrerUser = referrerUserRows[0];
    if (
      referrerUser?.email &&
      referrerUser.email.toLowerCase() === newUserEmail.toLowerCase()
    ) {
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
      // UNIQUE (referred_id): this user was already attributed.
      if (insertError.code === "23505") {
        console.warn(
          `[recordReferralOnSignup] Duplicate referral for ${newUserId} -- already attributed`,
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

    // May award a week if the referrer now has enough verified referrals.
    const grantResult = await triggerReferralGrant(referrerId);
    if (!grantResult.success) {
      // Non-fatal: the referral is recorded and the next grant call picks it up.
      console.error(
        `[recordReferralOnSignup] Grant trigger failed for referrer ${referrerId}: ${grantResult.message}`,
      );
    } else if (grantResult.weeksGranted > 0) {
      console.log(
        `[recordReferralOnSignup] Referrer ${referrerId} earned ${grantResult.weeksGranted} week(s) of Creator access`,
      );
    }

    return { success: true };
  } catch (error) {
    console.error(
      "[recordReferralOnSignup] Unexpected error:",
      error instanceof Error ? error.message : error,
    );
    return { success: false, message: "Unexpected error during referral attribution" };
  }
}
