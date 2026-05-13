"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { authCheck } from "@/actions/server/authCheck";

/**
 * Returns true if user has a subscription in an active state.
 *
 * Policy: past_due is NOT considered active. Users whose payment failed
 * must update their card via the customer portal before regaining access.
 *
 * Statuses counted as active:
 *   - active: payment succeeded, subscription in good standing
 *   - trialing: trial period, will be charged at trial end
 */
export async function checkUserSubscription(
  userId: string | null,
): Promise<boolean> {
  const result = await authCheck(userId);
  if (!result) {
    console.error(`[checkUserSubscription] Auth failed for userId: ${userId}`);
    return false;
  }

  try {
    const { data, error } = await adminSupabase
      .from("stripe_subscriptions")
      .select("status")
      .eq("user_id", userId!)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(
        `[checkUserSubscription] DB error for ${userId}: ${error.message}`,
      );
      return false;
    }

    if (!data) return false;

    const ACTIVE_STATUSES = ["active", "trialing"];
    return ACTIVE_STATUSES.includes(data.status);
  } catch (unexpectedErr) {
    console.error(
      "[checkUserSubscription] Unexpected error:",
      unexpectedErr instanceof Error ? unexpectedErr.message : unexpectedErr,
    );
    return false;
  }
}
