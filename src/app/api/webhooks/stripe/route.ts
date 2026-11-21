import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { cancelFutureScheduledPostsOnSubCancel } from "@/actions/server/data/cancelFutureScheduledPostsOnSubCancel";
import { demoteOauthClientsOnCancel } from "@/actions/server/data/demoteOauthClientsOnCancel";
import { promoteOauthClientsOnResubscribe } from "@/actions/server/data/promoteOauthClientsOnResubscribe";
import { resumeCancelledPostsOnResubscribe } from "@/actions/server/data/resumeCancelledPostsOnResubscribe";
import {
  recordInvoicePayment,
  type InvoicePaymentOutcome,
} from "@/actions/server/stripe/recordInvoicePayment";
import {
  isStripeEventProcessed,
  markStripeEventProcessed,
} from "@/actions/server/stripe/stripeEventLog";
import { toSubscriptionRow } from "@/actions/server/stripe/toSubscriptionRow";
import { db, runQuery } from "@/db/client";
import { stripe_subscriptions, users } from "@/db/schema";
import { invalidateCachedOAuthClientsByUser } from "@/lib/mcp/auth/oauthClientCache";
import { invalidateCachedSubscription } from "@/lib/mcp/auth/resolvers/subscriptionCache";

import stripe from "@/lib/stripe";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs";

type SubscriptionEvent =
  | Stripe.CustomerSubscriptionCreatedEvent
  | Stripe.CustomerSubscriptionUpdatedEvent
  | Stripe.CustomerSubscriptionDeletedEvent;

type InvoiceOutcomeEvent =
  | Stripe.InvoicePaymentSucceededEvent
  | Stripe.InvoicePaidEvent
  | Stripe.InvoicePaymentFailedEvent
  | Stripe.InvoiceMarkedUncollectibleEvent;

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

  const runEventHandler = selectEventHandler(event);
  if (!runEventHandler) {
    console.log(`[POST] Ignored Stripe event type: ${event.type}`);
    return ok({ ignored: event.type });
  }

  // Stripe retries an event without a 2xx answer for up to three days:
  // https://docs.stripe.com/webhooks#automatic-retries
  const processedCheck = await isStripeEventProcessed(event.id);
  if (!processedCheck.ok) {
    return err("Could not read the event log", 500);
  }
  if (processedCheck.isProcessed) {
    return ok({ duplicate: true, event_id: event.id });
  }

  let response: NextResponse;
  try {
    response = await runEventHandler();
  } catch (processingErr) {
    console.error(
      `[Stripe webhook] Processing failed for ${event.id}:`,
      processingErr instanceof Error ? processingErr.message : processingErr,
    );
    return err("Processing failed", 500);
  }

  const logged = await markStripeEventProcessed({
    event_id: event.id,
    type: event.type,
    livemode: event.livemode,
  });
  if (!logged.ok) {
    return err("Could not log the event", 500);
  }
  return response;
}

function selectEventHandler(
  event: Stripe.Event,
): (() => Promise<NextResponse>) | null {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return () => handleSubscriptionEvent(event);
    case "invoice.payment_succeeded":
    case "invoice.paid":
      return () => handleInvoiceEvent(event, "succeeded");
    case "invoice.payment_failed":
    case "invoice.marked_uncollectible":
      return () => handleInvoiceEvent(event, "failed");
    default:
      return null;
  }
}

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

async function handleSubscriptionEvent(event: SubscriptionEvent) {
  const eventSubscription = event.data.object;
  const stripeCustomerId =
    typeof eventSubscription.customer === "string"
      ? eventSubscription.customer
      : eventSubscription.customer.id;

  const userId = await findUserIdForCustomer(stripeCustomerId);
  if (!userId) {
    console.error(`[Stripe webhook] No user for customer ${stripeCustomerId}`);
    return ok({ no_user_match: true });
  }

  const subscription = await retrieveCurrentSubscription(eventSubscription);
  const subscriptionRow = toSubscriptionRow(
    subscription,
    userId,
    stripeCustomerId,
  );
  const { error } = await runQuery(
    db
      .insert(stripe_subscriptions)
      .values(subscriptionRow)
      .onConflictDoUpdate({
        target: stripe_subscriptions.stripe_subscription_id,
        set: subscriptionRow,
      }),
  );

  if (error) {
    throw new Error(
      `Failed to store subscription ${subscription.id}: ${error.message}`,
    );
  }

  invalidateCachedSubscription(userId);

  const access = await checkActiveSubscription(userId);
  if (access.status === "unavailable") {
    throw new Error(`Access check failed for ${userId}`);
  }
  if (access.isActive) {
    await restoreSubscriberAccess(userId);
  } else {
    await revokeSubscriberAccess(userId);
  }

  return ok({
    subscription_status: subscription.status,
    user_id: userId,
    has_access: access.isActive,
  });
}

// Stripe does not guarantee event order, so a payload can be older than the row
// a later event wrote; the current object is stored instead:
// https://docs.stripe.com/webhooks#event-ordering
async function retrieveCurrentSubscription(
  eventSubscription: Stripe.Subscription,
): Promise<Stripe.Subscription> {
  try {
    return await stripe.subscriptions.retrieve(eventSubscription.id);
  } catch (retrieveError) {
    const isGoneFromStripe =
      retrieveError instanceof Stripe.errors.StripeInvalidRequestError &&
      retrieveError.code === "resource_missing";
    if (!isGoneFromStripe) throw retrieveError;
    return eventSubscription;
  }
}

async function restoreSubscriberAccess(userId: string): Promise<void> {
  const resumeResult = await resumeCancelledPostsOnResubscribe(userId);
  if (!resumeResult.success) {
    throw new Error(`Post resume failed for ${userId}: ${resumeResult.message}`);
  }

  const promoteResult = await promoteOauthClientsOnResubscribe(userId);
  invalidateCachedOAuthClientsByUser(userId);
  if (!promoteResult.success) {
    throw new Error(
      `OAuth promotion failed for ${userId}: ${promoteResult.message}`,
    );
  }
}

async function revokeSubscriberAccess(userId: string): Promise<void> {
  const demoteResult = await demoteOauthClientsOnCancel(userId);
  invalidateCachedOAuthClientsByUser(userId);
  if (!demoteResult.success) {
    throw new Error(
      `OAuth demotion failed for ${userId}: ${demoteResult.message}`,
    );
  }

  const cancelResult = await cancelFutureScheduledPostsOnSubCancel(userId);
  if (!cancelResult.success) {
    throw new Error(
      `Scheduled-post cancel failed for ${userId}: ${cancelResult.message}`,
    );
  }
}

async function handleInvoiceEvent(
  event: InvoiceOutcomeEvent,
  outcome: InvoicePaymentOutcome,
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

  if (!invoice.id) {
    console.error(`[Stripe webhook] ${event.id} carries an invoice without an id`);
    return ok({ ignored: "invoice_without_id" });
  }

  const recorded = await recordInvoicePayment({
    userId,
    stripeInvoiceId: invoice.id,
    outcome,
    amountPaidCents: invoice.amount_paid,
    currency: invoice.currency,
  });
  if (!recorded.ok) {
    throw new Error(`Failed to record invoice ${invoice.id}`);
  }

  return ok({ invoice: outcome, user_id: userId });
}
