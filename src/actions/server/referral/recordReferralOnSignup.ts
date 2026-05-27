import "server-only";

import { cookies } from "next/headers";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { triggerReferralGrant } from "./triggerReferralGrant";

/**
 * Reads the stx_ref attribution cookie, resolves the referral code to a
 * referrer, validates the referral, and inserts a referral row.
 *
 * Because Clerk enforces email verification before the user.created event
 * fires, the referral is inserted directly as "verified" and the grant
 * trigger is called immediately.
 *
 * Entirely best-effort: any failure is logged and returns an error value.
 * MUST NEVER block user creation.
 *
 * Called by: ensureUserExists, on FIRST user creation only.
 *
 * Tables: referral_codes (read), referrals (insert), users (read)
 * Side effects: may call triggerReferralGrant (which calls the RPC + cache invalidation)
 */
export async function recordReferralOnSignup(
  newUserId: string,
  newUserEmail: string,
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    // Read the attribution cookie set by the middleware
    const cookieStore = await cookies();
    const refCookie = cookieStore.get("stx_ref");
    if (!refCookie?.value) {
      return { success: true }; // No referral attribution -- normal signup
    }

    const referralCode = refCookie.value;

    // Resolve the code to a referrer
    const { data: codeRow, error: codeError } = await adminSupabase
      .from("referral_codes")
      .select("user_id")
      .eq("code", referralCode)
      .maybeSingle();

    if (codeError) {
      console.error(
        `[recordReferralOnSignup] Failed to resolve code "${referralCode}":`,
        codeError.message,
      );
      return { success: false, message: "Failed to resolve referral code" };
    }

    if (!codeRow) {
      console.warn(
        `[recordReferralOnSignup] Unknown referral code "${referralCode}" for user ${newUserId}`,
      );
      // Clear the invalid cookie so it doesn't persist
      cookieStore.delete("stx_ref");
      return { success: false, message: "Unknown referral code" };
    }

    const referrerId = codeRow.user_id;

    // --- Validation: self-referral by user ID ---
    if (referrerId === newUserId) {
      console.warn(
        `[recordReferralOnSignup] Self-referral blocked (same ID) for ${newUserId}`,
      );
      cookieStore.delete("stx_ref");
      return { success: false, message: "Self-referral not allowed" };
    }

    // --- Validation: self-referral by email ---
    const { data: referrerUser } = await adminSupabase
      .from("users")
      .select("email")
      .eq("id", referrerId)
      .maybeSingle();

    if (
      referrerUser?.email &&
      referrerUser.email.toLowerCase() === newUserEmail.toLowerCase()
    ) {
      console.warn(
        `[recordReferralOnSignup] Self-referral blocked (same email) for ${newUserId}`,
      );
      cookieStore.delete("stx_ref");
      return { success: false, message: "Self-referral not allowed" };
    }

    // --- Insert referral row (status = verified, since Clerk forces email verification) ---
    const nowIso = new Date().toISOString();
    const { error: insertError } = await adminSupabase
      .from("referrals")
      .insert({
        referrer_id: referrerId,
        referred_id: newUserId,
        status: "verified",
        verified_at: nowIso,
      });

    if (insertError) {
      // Unique constraint on referred_id means this user was already attributed
      if (insertError.code === "23505") {
        console.warn(
          `[recordReferralOnSignup] Duplicate referral for ${newUserId} -- already attributed`,
        );
        cookieStore.delete("stx_ref");
        return { success: true }; // Not an error, just already done
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

    // Clear the cookie now that attribution is persisted
    cookieStore.delete("stx_ref");

    // Fire the grant trigger for the referrer (may award a week if they hit 3)
    const grantResult = await triggerReferralGrant(referrerId);
    if (!grantResult.success) {
      // Non-fatal: the referral is recorded, the grant can be retried later
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
