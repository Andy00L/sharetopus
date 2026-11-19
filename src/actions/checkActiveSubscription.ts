import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { stripe_subscriptions, users } from "@/db/schema";
import { priceIdToTier, type PlanTier } from "@/lib/types/plans";

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "referral_grant"
  | "none"
  | "unavailable";

export type InactiveSubscriptionStatus = Extract<
  SubscriptionStatus,
  "none" | "unavailable"
>;

export type ActiveSubscription =
  | {
      isActive: true;
      status: Exclude<SubscriptionStatus, InactiveSubscriptionStatus>;
      priceId: string | null;
      tier: PlanTier | null;
      currentPeriodEnd: string | null;
      startDate: string | null;
    }
  | {
      isActive: false;
      status: InactiveSubscriptionStatus;
      priceId: null;
      tier: null;
      currentPeriodEnd: null;
      startDate: null;
    };

export async function checkActiveSubscription(
  userId: string | null,
): Promise<ActiveSubscription> {
  if (userId === null) {
    return inactiveSubscription("none");
  }

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
    return inactiveSubscription("unavailable");
  }

  const activeSubscription = subscriptionRows[0];
  if (!activeSubscription) {
    const { data: userRows, error: userError } = await runQuery(
      db
        .select({ creator_access_until: users.creator_access_until })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
    );

    if (userError) {
      console.error(
        `[checkActiveSubscription] Referral access read failed for user ${userId}:`,
        userError.message,
      );
      return inactiveSubscription("unavailable");
    }

    const creatorAccessUntil = userRows[0]?.creator_access_until;
    if (creatorAccessUntil && new Date(creatorAccessUntil) > new Date()) {
      return {
        isActive: true,
        priceId: null,
        tier: "creator",
        status: "referral_grant",
        currentPeriodEnd: creatorAccessUntil,
        startDate: null,
      };
    }

    return inactiveSubscription("none");
  }

  const priceId = activeSubscription.stripe_price_id;
  const tier = priceIdToTier(priceId);

  return {
    isActive: true,
    priceId,
    tier,
    status: activeSubscription.status === "trialing" ? "trialing" : "active",
    currentPeriodEnd: activeSubscription.current_period_end,
    startDate: activeSubscription.start_date,
  };
}

function inactiveSubscription(
  status: InactiveSubscriptionStatus,
): ActiveSubscription {
  return {
    isActive: false,
    priceId: null,
    tier: null,
    status,
    currentPeriodEnd: null,
    startDate: null,
  };
}
