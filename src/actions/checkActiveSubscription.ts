import { adminSupabase } from "@/actions/api/adminSupabase";
import { priceIdToTier, type PlanTier } from "@/lib/types/plans";
import "server-only";

/**
 * Checks if a user has an active subscription and resolves the plan tier.
 *
 * The `plan` field is the raw value from the DB (a priceId string).
 * The `tier` field is derived via priceIdToTier at this single call site.
 * Callers should use `tier` for business logic and `plan` for Stripe ops.
 */
export async function checkActiveSubscription(userId: string | null): Promise<{
  plan: string | null;
  tier: PlanTier | null;
  isActive: boolean;
}> {
  const emptyResult = {
    isActive: false,
    plan: null,
    tier: null,
  };

  if (!userId) {
    console.error(`[checkActiveSubscription] No userId provided`);
    return emptyResult;
  }

  try {
    const { data, error } = await adminSupabase
      .from("stripe_subscriptions")
      .select("stripe_price_id, status, current_period_end")
      .eq("user_id", userId)
      .in("status", ["active", "trialing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(
        `[checkActiveSubscription] DB error for user ${userId}:`,
        error,
      );
      return emptyResult;
    }

    if (!data) {
      return emptyResult;
    }

    const priceId = data.stripe_price_id;
    const tier = priceIdToTier(priceId);

    return {
      isActive: true,
      plan: priceId,
      tier,
    };
  } catch (err) {
    console.error("[checkActiveSubscription] Unexpected error:", err);
    return emptyResult;
  }
}
