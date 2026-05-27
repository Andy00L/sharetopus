"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { priceIdToTier, type PlanTier } from "@/lib/types/plans";

export type ActiveSubscription = {
  isActive: boolean;
  priceId: string | null;
  tier: PlanTier | null;
  status: string;
  currentPeriodEnd: string | null;
  startDate: string | null;
};

/**
 * Canonical subscription reader. Used by both MCP and web paths.
 *
 * Reads stripe_price_id from the DB and resolves the tier via
 * priceIdToTier at this single call site. Callers consume .tier
 * for business logic and .priceId for Stripe ops.
 *
 * The "use server" directive makes this callable from both server
 * components and client components (as a server action).
 */
export async function checkActiveSubscription(
  userId: string | null,
): Promise<ActiveSubscription> {
  const emptyResult: ActiveSubscription = {
    isActive: false,
    priceId: null,
    tier: null,
    status: "none",
    currentPeriodEnd: null,
    startDate: null,
  };

  if (userId === null) {
    return emptyResult;
  }

  try {
    const { data, error } = await adminSupabase
      .from("stripe_subscriptions")
      .select("stripe_price_id, status, current_period_end, start_date")
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
      // Referral-granted Creator access fallback: if the user has no active
      // Stripe subscription, check whether referral rewards have banked time
      // via the creator_access_until column (set by the grant_referral_rewards RPC).
      const { data: userData } = await adminSupabase
        .from("users")
        .select("creator_access_until")
        .eq("id", userId)
        .single();

      if (
        userData?.creator_access_until &&
        new Date(userData.creator_access_until) > new Date()
      ) {
        return {
          isActive: true,
          priceId: null,
          tier: "creator" as PlanTier,
          status: "referral_grant",
          currentPeriodEnd: userData.creator_access_until,
          startDate: null,
        };
      }

      return emptyResult;
    }

    const priceId = data.stripe_price_id;
    const tier = priceIdToTier(priceId);

    return {
      isActive: true,
      priceId,
      tier,
      status: data.status,
      currentPeriodEnd: data.current_period_end,
      startDate: data.start_date,
    };
  } catch (err) {
    console.error("[checkActiveSubscription] Unexpected error:", err);
    return emptyResult;
  }
}
