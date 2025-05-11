"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { auth } from "@clerk/nextjs/server";

/**
 * Checks if a user has an active subscription.
 *
 * Active subscriptions are those with status: 'active', 'trialing', or 'past_due'
 * (past_due subscriptions are still considered active until they're explicitly canceled)
 *
 * @param userId - The ID of the user to check
 * @returns A promise that resolves to a boolean indicating if the user has an active subscription
 */
export async function checkUserSubscription(): Promise<boolean> {
  const { userId } = await auth();
  try {
    console.log("[checkUserSubscription]  ${userId}");

    // Query the stripe_subscriptions table for any active subscriptions
    const { data, error } = await adminSupabase
      .from("stripe_subscriptions")
      .select(" status")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }) // Get the most recent first
      .limit(1); // We only need to know if at least one exists
    console.log("[checkUserSubscription]: Query result:", {
      dataExists: !!data,
      dataLength: data?.length,
      errorExists: !!error,
    });
    if (error) {
      if (error.code === "PGRST116") {
        // This is expected when user has no subscription
        return false;
      }
      console.error("[checkUserSubscription]: Database query error:", error);
      // In case of error, we default to false to avoid giving access incorrectly
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
