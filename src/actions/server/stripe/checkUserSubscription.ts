"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { authCheck } from "@/actions/server/authCheck";

/**
 * Checks if a user has an active subscription in Stripe.
 *
 * Subscription status meanings:
 * - 'active': Subscription is in good standing and the customer has been charged successfully
 * - 'trialing': Subscription is in trial period and hasn't been charged yet
 * - 'past_due': Payment has failed but Stripe is still attempting to collect payment
 *   (past_due subscriptions are still considered active until payment attempts are exhausted)
 *
 * @returns {Promise<boolean>} True if user has an active, trialing, or past_due subscription; false otherwise
 */
export async function checkUserSubscription(
  userId: string | null
): Promise<boolean> {
  // Get authenticated user ID from Clerk auth

  // Validate the user is properly authenticated
  const result = await authCheck(userId);
  if (!result) {
    console.error(
      `[checkUserSubscription] Authentication check failed for userId: ${userId}`
    );
    return false;
  }

  try {
    console.log(
      `[checkUserSubscription] Checking subscription status for user: ${userId}`
    );

    // Query the stripe_subscriptions table to find the most recent subscription
    const { data, error } = await adminSupabase
      .from("stripe_subscriptions")
      .select("status")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }) // Get the most recent subscription first
      .limit(1); // We only need the most recent subscription

    if (error) {
      if (error.code === "PGRST116") {
        // This is expected when user has no subscription
        return false;
      }
      console.error("[checkUserSubscription]: Database query error:", error);
      // In case of error, we default to false to avoid giving access incorrectly
      return false;
    }

    if (!data || data.length === 0) {
      console.error("[checkUserSubscription]: No subscription found for user");
      return false;
    }

    // If we found at least one matching subscription, the user has an active subscription
    const activeStatuses = ["active", "trialing", "past_due"];

    return activeStatuses.includes(data[0].status);
  } catch (error) {
    console.error("[checkUserSubscription]: Unexpected error:", error);
    // In case of error, we default to false to avoid giving access incorrectly
    return false;
  }
}
