import { cancelFutureScheduledPostsOnSubCancel } from "@/actions/server/data/cancelFutureScheduledPostsOnSubCancel";
import { demoteOauthClientsOnCancel } from "@/actions/server/data/demoteOauthClientsOnCancel";
import { promoteOauthClientsOnResubscribe } from "@/actions/server/data/promoteOauthClientsOnResubscribe";
import { resumeCancelledPostsOnResubscribe } from "@/actions/server/data/resumeCancelledPostsOnResubscribe";
import {
  claimWebhookEvent,
  releaseWebhookEvent,
} from "@/actions/server/stripe/claimWebhookEvent";
import { toSubscriptionRow } from "@/actions/server/stripe/toSubscriptionRow";
import { db, runQuery } from "@/db/client";
import { stripe_invoices, stripe_subscriptions, users } from "@/db/schema";
import { invalidateCachedOAuthClientsByUser } from "@/lib/mcp/auth/oauthClientCache";
import { invalidateCachedSubscription } from "@/lib/mcp/auth/resolvers/subscriptionCache";

import stripe from "@/lib/stripe";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs";

function ok(body: Record<string, unknown> = {}) {
  return NextResponse.json({ received: true, ...body }, { status: 200 });
}

function err(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function getWebhookSecret(): string | null {
  const secret =
    process.env.NODE_ENV === "production"
      ? process.env.STRIPE_WEBHOOK_SECRET
      : process.env.STRIPE_WEBHOOK_SECRET_DEV;
  return secret ?? null;
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    console.error("[Stripe webhook] Missing stripe-signature header");
    return err("Missing signature", 400);
  }

  const webhookSecret = getWebhookSecret();
  if (!webhookSecret) {
    console.error("[Stripe webhook] STRIPE_WEBHOOK_SECRET not configured");
    return err("Webhook misconfigured", 500);
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
  } catch (signatureErr) {
    console.error(
      "[Stripe webhook] Signature verification failed:",
      signatureErr instanceof Error ? signatureErr.message : signatureErr,
    );
    return err("Invalid signature", 400);
  }

  // Idempotency claim. If Stripe is retrying, return 200 immediately.
  const claim = await claimWebhookEvent({
    event_id: event.id,
    type: event.type,
    livemode: event.livemode,
  });

  if (!claim.claimed && claim.reason === "duplicate") {
    return ok({ duplicate: true, event_id: event.id });
  }
  if (!claim.claimed && claim.reason === "error") {
    // DB blip. Return 500 so Stripe retries.
    return err(claim.message, 500);
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
        return await handleSubscriptionEvent(event, "created");
      case "customer.subscription.updated":
        return await handleSubscriptionEvent(event, "updated");
      case "customer.subscription.deleted":
        return await handleSubscriptionEvent(event, "deleted");
      case "invoice.payment_succeeded":
        return await handleInvoiceEvent(event, "succeeded");
      case "invoice.payment_failed":
        return await handleInvoiceEvent(event, "failed");
      default:
        console.log(`[Stripe webhook] Ignored event type: ${event.type}`);
        return ok({ ignored: event.type });
    }
  } catch (processingErr) {
    console.error(
      `[Stripe webhook] Processing failed for ${event.id}:`,
      processingErr instanceof Error ? processingErr.message : processingErr,
    );
    // Release claim so Stripe retry can re-process.
    await releaseWebhookEvent(event.id);
    return err("Processing failed", 500);
  }
}

/**
 * The id of the user a Stripe customer belongs to, or null when no user does.
 * A failed lookup throws: POST then releases the claim and answers 500, so
 * Stripe retries. Answering 200 there dropped the event for good, and with it
 * the record of a paid subscription.
 */
async function findUserIdForCustomer(
  stripeCustomerId: string,
): Promise<string | null> {
  const { data: userRows, error } = await runQuery(
    db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.stripe_customer_id, stripeCustomerId))
      .limit(1),
  );

  if (error) {
    throw new Error(
      `User lookup failed for customer ${stripeCustomerId}: ${error.message}`,
    );
  }
  return userRows[0]?.id ?? null;
}

async function handleSubscriptionEvent(
  event:
    | Stripe.CustomerSubscriptionCreatedEvent
    | Stripe.CustomerSubscriptionUpdatedEvent
    | Stripe.CustomerSubscriptionDeletedEvent,
  type: "created" | "updated" | "deleted",
) {
  const subscription = event.data.object;
  // Webhook payloads carry the customer id; the object form only appears when expanded.
  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  const userId = await findUserIdForCustomer(stripeCustomerId);
  if (!userId) {
    console.error(`[Stripe webhook] No user for customer ${stripeCustomerId}`);
    // No user will ever match this customer: 200 so Stripe stops retrying.
    return ok({ no_user_match: true });
  }

  const subscriptionData = toSubscriptionRow(
    subscription,
    userId,
    stripeCustomerId,
  );

  if (type === "deleted") {
    const { error } = await runQuery(
      db
        .update(stripe_subscriptions)
        .set({ status: "canceled" })
        .where(eq(stripe_subscriptions.stripe_subscription_id, subscription.id)),
    );

    if (error) {
      throw new Error(
        `Failed to mark subscription canceled: ${error.message}`,
      );
    }

    // Invalidate the MCP subscription cache so this Vercel instance
    // stops serving the cached active-subscription view immediately.
    // Other instances still see the stale entry until their TTL (60s)
    // expires; that bounded window is acceptable for cancellations.
    invalidateCachedSubscription(userId);

    const demoteResult = await demoteOauthClientsOnCancel(userId);
    if (!demoteResult.success) {
      console.error(
        `[Stripe webhook] OAuth demotion failed for ${userId}: ${demoteResult.message}`,
      );
    }

    invalidateCachedOAuthClientsByUser(userId);

    const cancelResult = await cancelFutureScheduledPostsOnSubCancel(userId);
    if (!cancelResult.success) {
      console.error(
        `[Stripe webhook] Scheduled-post cancel failed for ${userId}: ${cancelResult.message}`,
      );
    }

    return ok({ subscription: "deleted", user_id: userId });
  }

  if (type === "created") {
    // UPSERT so Stripe retry after partial processing is idempotent.
    const { error } = await runQuery(
      db
        .insert(stripe_subscriptions)
        .values(subscriptionData)
        .onConflictDoUpdate({
          target: stripe_subscriptions.stripe_subscription_id,
          set: subscriptionData,
        }),
    );

    if (error) {
      throw new Error(`Failed to upsert subscription: ${error.message}`);
    }

    // Invalidate any cached negative result for this principal. A user
    // who hit MCP before subscribing would have a cached isActive=false
    // entry; without this purge they would have to wait up to TTL (60s)
    // before MCP recognizes their new subscription.
    invalidateCachedSubscription(userId);

    const resumeResult = await resumeCancelledPostsOnResubscribe(userId);
    if (!resumeResult.success) {
      console.error(
        `[Stripe webhook] Post resume failed for ${userId}: ${resumeResult.message}`,
      );
    }

    const promoteResult = await promoteOauthClientsOnResubscribe(userId);
    if (!promoteResult.success) {
      console.error(
        `[Stripe webhook] OAuth promotion failed for ${userId}: ${promoteResult.message}`,
      );
    }
    invalidateCachedOAuthClientsByUser(userId);

    return ok({ subscription: "created", user_id: userId });
  }

  // type === "updated"
  const { error } = await runQuery(
    db
      .insert(stripe_subscriptions)
      .values(subscriptionData)
      .onConflictDoUpdate({
        target: stripe_subscriptions.stripe_subscription_id,
        set: subscriptionData,
      }),
  );

  if (error) {
    throw new Error(`Failed to update subscription: ${error.message}`);
  }

  // Invalidate the cache so plan changes (Starter -> Pro, status
  // transitions to past_due, etc.) are reflected on the next request
  // to this instance.
  invalidateCachedSubscription(userId);

  return ok({ subscription: "updated", user_id: userId });
}

async function handleInvoiceEvent(
  event: Stripe.InvoicePaymentSucceededEvent | Stripe.InvoicePaymentFailedEvent,
  status: "succeeded" | "failed",
) {
  const invoice = event.data.object;
  const stripeCustomerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : (invoice.customer?.id ?? null);

  const userId = stripeCustomerId
    ? await findUserIdForCustomer(stripeCustomerId)
    : null;
  if (!userId) {
    console.error(
      `[Stripe webhook] No user for invoice customer ${stripeCustomerId ?? "(none)"}`,
    );
    return ok({ no_user_match: true });
  }

  const invoiceData = {
    user_id: userId,
    stripe_invoice_id: invoice.id,
    amount_paid_cents: status === "succeeded" ? invoice.amount_paid : null,
    currency: invoice.currency,
    status,
  };

  // UPSERT to handle Stripe retry after partial success.
  const { error } = await runQuery(
    db
      .insert(stripe_invoices)
      .values(invoiceData)
      .onConflictDoUpdate({
        target: stripe_invoices.stripe_invoice_id,
        set: invoiceData,
      }),
  );

  if (error) {
    throw new Error(`Failed to upsert invoice: ${error.message}`);
  }

  return ok({ invoice: status, user_id: userId });
}
