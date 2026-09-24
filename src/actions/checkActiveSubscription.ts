"use server";

import { and, desc, eq, inArray } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { stripe_subscriptions, users } from "@/db/schema";
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
    const { data: subscriptionRows, error } = await runQuery(
      db
        .select({
          stripe_price_id: stripe_subscriptions.stripe_price_id,
          status: stripe_subscriptions.status,
          current_period_end: stripe_subscriptions.current_period_end,
          start_date: stripe_subscriptions.start_date,
        })
        .from(stripe_subscriptions)
        .where(
          and(
            eq(stripe_subscriptions.user_id, userId),
            inArray(stripe_subscriptions.status, ["active", "trialing"]),
          ),
        )
        .orderBy(desc(stripe_subscriptions.created_at))
        .limit(1),
    );

    if (error) {
      console.error(
        `[checkActiveSubscription] DB error for user ${userId}:`,
        error,
      );
      return emptyResult;
    }

    const activeSubscription = subscriptionRows[0];
    if (!activeSubscription) {
      // Referral-granted Creator access fallback: if the user has no active
      // Stripe subscription, check whether referral rewards have banked time
      // via the creator_access_until column (set by the grant_referral_rewards RPC).
      const { data: userRows } = await runQuery(
        db
          .select({ creator_access_until: users.creator_access_until })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1),
      );

      const userData = userRows?.[0];
      if (
        userData?.creator_access_until &&
        new Date(userData.creator_access_until) > new Date()
      ) {
        return {
          isActive: true,
          priceId: null,
          tier: "creator",
          status: "referral_grant",
          currentPeriodEnd: userData.creator_access_until,
          startDate: null,
        };
      }

      return emptyResult;
    }

    const priceId = activeSubscription.stripe_price_id;
    const tier = priceIdToTier(priceId);

    return {
      isActive: true,
      priceId,
      tier,
      status: activeSubscription.status,
      currentPeriodEnd: activeSubscription.current_period_end,
      startDate: activeSubscription.start_date,
    };
  } catch (err) {
    console.error("[checkActiveSubscription] Unexpected error:", err);
    return emptyResult;
  }
}
