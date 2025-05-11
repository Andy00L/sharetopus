import { adminSupabase } from "@/actions/api/adminSupabase";
import "server-only";

/**
 * Checks if a user has an active subscription
 */
export async function checkActiveSubscription(userId: string | null): Promise<{
  success: boolean;
  message: string;
  plan: string | null;
  isActive: boolean;
}> {
  if (!userId) {
    console.error(`[checkActiveSubscription] No userId provided`);
    return {
      success: false,
      message: "Missing required user ID",
      isActive: false,
      plan: null,
    };
  }

  try {
    console.log(
      `[checkActiveSubscription] Checking subscription status for user ${userId}`
    );

    const { data, error } = await adminSupabase
      .from("stripe_subscriptions")
      .select("*")
      .eq("user_id", userId)
      .eq("status", ["active", "trialing"])
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error("[checkActiveSubscription] Supabase query error:", error);
      return {
        success: false,
        message: `Database error: ${error.message}`,
        isActive: false,
        plan: null,
      };
    }

    const hasActiveSubscription = data && data.length > 0;
    const subscriptionPlan = hasActiveSubscription ? data[0].plan : null;

    console.log(
      `[checkActiveSubscription] User ${userId} subscription status: ${
        hasActiveSubscription ? "Active" : "Inactive"
      }, Plan: ${subscriptionPlan ?? "None"}`
    );

    return {
      success: true,
      message: hasActiveSubscription
        ? "User has an active subscription"
        : "User does not have an active subscription",
      isActive: hasActiveSubscription,
      plan: subscriptionPlan,
    };
  } catch (err) {
    console.error("[checkActiveSubscription] Unexpected error:", err);
    return {
      success: false,
      message: "An unexpected error occurred",
      isActive: false,
      plan: null,
    };
  }
}
