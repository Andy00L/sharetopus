import { adminSupabase } from "@/actions/api/adminSupabase";
import "server-only";

/**
 * Checks if a user has an active subscription
 */
export async function checkActiveSubscription(userId: string | null): Promise<{
  success: boolean;
  message: string;
  isActive: boolean;
}> {
  if (!userId) {
    return {
      success: false,
      message: "Missing required user ID",
      isActive: false,
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
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error("[checkActiveSubscription] Supabase query error:", error);
      return {
        success: false,
        message: `Database error: ${error.message}`,
        isActive: false,
      };
    }

    const hasActiveSubscription = data && data.length > 0;

    console.log(
      `[checkActiveSubscription] User ${userId} subscription status: ${
        hasActiveSubscription ? "Active" : "Inactive"
      }`
    );

    return {
      success: true,
      message: hasActiveSubscription
        ? "User has an active subscription"
        : "User does not have an active subscription",
      isActive: hasActiveSubscription,
    };
  } catch (err) {
    console.error("[checkActiveSubscription] Unexpected error:", err);
    return {
      success: false,
      message: "An unexpected error occurred",
      isActive: false,
    };
  }
}
