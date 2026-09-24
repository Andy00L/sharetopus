import "server-only";

import type Stripe from "stripe";

import type { stripe_subscriptions } from "@/db/schema";

/**
 * The stripe_subscriptions row for a Stripe subscription. The Stripe webhook
 * and the ensureUserExists sync both write through it, so a synced row has
 * the webhook's columns (the sync used to leave current_period_end empty).
 */
export function toSubscriptionRow(
  subscription: Stripe.Subscription,
  userId: string,
  stripeCustomerId: string,
): typeof stripe_subscriptions.$inferInsert {
  // Since Stripe API 2025-03-31 each item carries its own billing period; the
  // subscription's period ends with its earliest item.
  const itemPeriodEnds = subscription.items.data.map(
    (subscriptionItem) => subscriptionItem.current_period_end,
  );
  const periodEndIso =
    itemPeriodEnds.length > 0
      ? new Date(Math.min(...itemPeriodEnds) * 1000).toISOString()
      : null;

  return {
    user_id: userId,
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    start_date: new Date(subscription.created * 1000).toISOString(),
    end_date: periodEndIso,
    current_period_end: periodEndIso,
    stripe_price_id: subscription.items.data[0]?.price.id ?? null,
  };
}
