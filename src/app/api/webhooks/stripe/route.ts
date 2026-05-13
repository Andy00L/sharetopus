import { adminSupabase } from "@/actions/api/adminSupabase";
import { cancelFutureScheduledPostsOnSubCancel } from "@/actions/server/data/cancelFutureScheduledPostsOnSubCancel";
import { demoteOauthClientsOnCancel } from "@/actions/server/data/demoteOauthClientsOnCancel";
import { promoteOauthClientsOnResubscribe } from "@/actions/server/data/promoteOauthClientsOnResubscribe";
import { resumeCancelledPostsOnResubscribe } from "@/actions/server/data/resumeCancelledPostsOnResubscribe";
import {
  claimWebhookEvent,
  releaseWebhookEvent,
} from "@/actions/server/stripe/claimWebhookEvent";
import stripe from "@/lib/stripe";
import { priceIdToTier } from "@/lib/types/plans";
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

async function handleSubscriptionEvent(
  event: Stripe.Event,
  type: "created" | "updated" | "deleted",
) {
  const subscription = event.data.object as Stripe.Subscription;
  const stripeCustomerId = subscription.customer as string;

  const { data: userData, error: userError } = await adminSupabase
    .from("users")
    .select("id")
    .eq("stripe_customer_id", stripeCustomerId)
    .single();

  if (userError || !userData) {
    console.error(
      `[Stripe webhook] No user for customer ${stripeCustomerId}: ${userError?.message ?? "not found"}`,
    );
    // Permanent error: 200 so Stripe stops retrying.
    return ok({ no_user_match: true });
  }

  const userId = userData.id;
  const priceId = subscription.items.data[0]?.price?.id ?? null;
  const periodEndMs =
    Math.min(...subscription.items.data.map((i) => i.current_period_end)) *
    1000;
  const periodEndIso = new Date(periodEndMs).toISOString();

  const subscriptionData = {
    user_id: userId,
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    start_date: new Date(subscription.created * 1000).toISOString(),
    end_date: periodEndIso,
    current_period_end: periodEndIso,
    stripe_price_id: priceId,
    plan: priceIdToTier(priceId),
  };

  if (type === "deleted") {
    const { error } = await adminSupabase
      .from("stripe_subscriptions")
      .update({ status: "cancelled" })
      .eq("stripe_subscription_id", subscription.id);

    if (error) {
      throw new Error(
        `Failed to mark subscription cancelled: ${error.message}`,
      );
    }

    const demoteResult = await demoteOauthClientsOnCancel(userId);
    if (!demoteResult.success) {
      console.error(
        `[Stripe webhook] OAuth demotion failed for ${userId}: ${demoteResult.message}`,
      );
    }

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
    const { error } = await adminSupabase
      .from("stripe_subscriptions")
      .upsert(subscriptionData, { onConflict: "stripe_subscription_id" });

    if (error) {
      throw new Error(`Failed to upsert subscription: ${error.message}`);
    }

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

    return ok({ subscription: "created", user_id: userId });
  }

  // type === "updated"
  const { error } = await adminSupabase
    .from("stripe_subscriptions")
    .upsert(subscriptionData, { onConflict: "stripe_subscription_id" });

  if (error) {
    throw new Error(`Failed to update subscription: ${error.message}`);
  }

  return ok({ subscription: "updated", user_id: userId });
}

async function handleInvoiceEvent(
  event: Stripe.Event,
  status: "succeeded" | "failed",
) {
  const invoice = event.data.object as Stripe.Invoice;
  const stripeCustomerId = invoice.customer as string;

  const { data: userData, error: userError } = await adminSupabase
    .from("users")
    .select("id")
    .eq("stripe_customer_id", stripeCustomerId)
    .single();

  if (userError || !userData) {
    console.error(
      `[Stripe webhook] No user for invoice customer ${stripeCustomerId}: ${userError?.message ?? "not found"}`,
    );
    return ok({ no_user_match: true });
  }

  const invoiceData = {
    user_id: userData.id,
    stripe_invoice_id: invoice.id,
    amount_paid_cents: status === "succeeded" ? invoice.amount_paid : null,
    currency: invoice.currency,
    status,
  };

  // UPSERT to handle Stripe retry after partial success.
  const { error } = await adminSupabase
    .from("stripe_invoices")
    .upsert(invoiceData, { onConflict: "stripe_invoice_id" });

  if (error) {
    throw new Error(`Failed to upsert invoice: ${error.message}`);
  }

  return ok({ invoice: status, user_id: userData.id });
}
