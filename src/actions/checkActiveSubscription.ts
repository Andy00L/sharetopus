import "server-only";

import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import {
  ACCESS_GRANTING_SUBSCRIPTION_STATUSES,
  stripe_subscriptions,
  users,
  type CreatedVia,
  type StripeSubscriptionStatus,
} from "@/db/schema";
import { priceIdToTier, type PlanTier } from "@/lib/types/plans";

const PAID_PER_POST_CHANNEL: CreatedVia = "x402";

type AccessGrantingStatus = (typeof ACCESS_GRANTING_SUBSCRIPTION_STATUSES)[number];

export type SubscriptionStatus =
  | AccessGrantingStatus
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

export type PrincipalsAccessLookup =
  | { success: true; principalIdsWithAccess: Set<string> }
  | { success: false; message: string };

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
          inArray(stripe_subscriptions.status, [...ACCESS_GRANTING_SUBSCRIPTION_STATUSES]),
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

  const activeSubscription = subscriptionRows.find(grantsAccess);
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

    const creatorAccessUntil = userRows[0]?.creator_access_until ?? null;
    if (creatorAccessUntil && hasReferralAccess(creatorAccessUntil, new Date())) {
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
    status: activeSubscription.status,
    currentPeriodEnd: activeSubscription.current_period_end,
    startDate: activeSubscription.start_date,
  };
}

export async function findPrincipalsWithAccess(
  principalIds: readonly string[],
  now: Date = new Date(),
): Promise<PrincipalsAccessLookup> {
  const principalIdsWithAccess = new Set<string>();
  if (principalIds.length === 0) return { success: true, principalIdsWithAccess };

  const { data: subscribedRows, error: subscriptionsError } = await runQuery(
    db
      .selectDistinct({ user_id: stripe_subscriptions.user_id })
      .from(stripe_subscriptions)
      .where(
        and(
          inArray(stripe_subscriptions.user_id, [...principalIds]),
          inArray(stripe_subscriptions.status, [...ACCESS_GRANTING_SUBSCRIPTION_STATUSES]),
        ),
      ),
  );
  if (subscriptionsError) {
    return {
      success: false,
      message: `[findPrincipalsWithAccess] Subscription read failed: ${subscriptionsError.message}`,
    };
  }
  for (const subscribedRow of subscribedRows) principalIdsWithAccess.add(subscribedRow.user_id);

  const unsubscribedIds = principalIds.filter(
    (principalId) => !principalIdsWithAccess.has(principalId),
  );
  if (unsubscribedIds.length === 0) return { success: true, principalIdsWithAccess };

  const { data: referralRows, error: referralError } = await runQuery(
    db
      .select({ id: users.id, creator_access_until: users.creator_access_until })
      .from(users)
      .where(and(inArray(users.id, unsubscribedIds), isNotNull(users.creator_access_until))),
  );
  if (referralError) {
    return {
      success: false,
      message: `[findPrincipalsWithAccess] Referral access read failed: ${referralError.message}`,
    };
  }
  for (const referralRow of referralRows) {
    if (referralRow.creator_access_until && hasReferralAccess(referralRow.creator_access_until, now)) {
      principalIdsWithAccess.add(referralRow.id);
    }
  }
  return { success: true, principalIdsWithAccess };
}

export function needsOwnerAccessToPublish(post: { created_via: CreatedVia }): boolean {
  return post.created_via !== PAID_PER_POST_CHANNEL;
}

function hasReferralAccess(creatorAccessUntil: string, now: Date): boolean {
  return new Date(creatorAccessUntil) > now;
}

function grantsAccess<Row extends { status: StripeSubscriptionStatus }>(
  row: Row,
): row is Row & { status: AccessGrantingStatus } {
  return ACCESS_GRANTING_SUBSCRIPTION_STATUSES.some((status) => status === row.status);
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
