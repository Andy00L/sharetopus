// app/api/stripe/webhook/route.ts
import { adminSupabase } from "@/actions/api/adminSupabase";
import stripe from "@/lib/stripe";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return new NextResponse("Missing signature", { status: 400 });
  }

  try {
    const event = await stripe.webhooks.constructEventAsync(
      body,
      sig,
      process.env.NODE_ENV === "production"
        ? process.env.STRIPE_WEBHOOK_SECRET!
        : process.env.STRIPE_WEBHOOK_SECRET_DEV!
    );

    // Handle different event types
    // Handle different event types with proper type casting
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
        console.log(`Unhandled event type: ${event.type}`);
        return NextResponse.json({
          status: 400,
          error: "Unhandled event type",
        });
    }
  } catch (err) {
    console.error("[Stripe route.ts] Error constucting Stripe event:", err);
    return NextResponse.json({
      status: 500,
      error: "Webhook Error: Invalid Signature",
    });
  }
}

async function handleSubscriptionEvent(
  event: Stripe.Event,
  type: "created" | "updated" | "deleted"
) {
  const subscription = event.data.object as Stripe.Subscription;
  const stripeCustomerId = subscription.customer as string;

  // Look up the user associated with this Stripe customer
  const { data: userData, error: userError } = await adminSupabase
    .from("users")
    .select("id")
    .eq("stripe_customer_id", stripeCustomerId)
    .single();

  if (userError || !userData) {
    console.error(
      "[Stripe route.ts] No user found for customer:",
      stripeCustomerId
    );
    // Return 200 so Stripe doesn't retry (it's not a temporary error)
    return NextResponse.json({
      status: 200, // Still return 200 to acknowledge the webhook
      message: "Processed but no matching user found",
    });
  }

  const userId = userData.id;
  const subscriptionData = {
    user_id: userId,
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    start_date: new Date(subscription.created * 1000).toISOString(),
    end_date: new Date(
      Math.min(...subscription.items.data.map((i) => i.current_period_end)) *
        1000
    ).toISOString(),

    plan: subscription.items.data[0]?.plan.id,
  };

  if (type === "deleted") {
    const { error } = await adminSupabase
      .from("stripe_subscriptions")
      .update({ status: "cancelled" })
      .match({ stripe_subscription_id: subscription.id });
    if (error) {
      console.error("[Stripe route.ts] Error updating the subscription status:", error);
    }
  } else if (type === "created") {
    const { error } = await adminSupabase
      .from("stripe_subscriptions")
      .insert([subscriptionData]);
    if (error) {
      console.error("[Stripe route.ts] Error during subscription created:", error);
      return NextResponse.json({
        status: 500,
        error: "Error during subscription insert",
      });
    }
  } else {
    const { error } = await adminSupabase
      .from("stripe_subscriptions")
      .update(subscriptionData)
      .match({ stripe_subscription_id: subscription.id });
    if (error) {
      console.error("[Stripe route.ts] Error during subscription updated:", error);
      return NextResponse.json({
        status: 500,
        error: "Error during subscription update",
      });
    }
  }

  return NextResponse.json({
    status: 200,
    message: `Subscription ${type}`,
  });
}

async function handleInvoiceEvent(
  event: Stripe.Event,
  status: "succeeded" | "failed"
) {
  const invoice = event.data.object as Stripe.Invoice;

  const stripeCustomerId = invoice.customer as string;

  // Look up the user...
  const { data: userData, error: userError } = await adminSupabase
    .from("users")
    .select("id")
    .eq("stripe_customer_id", stripeCustomerId)
    .single();

  if (userError || !userData) {
    console.error(
      "[Stripe route.ts] No user found for customer:",
      stripeCustomerId
    );
    return NextResponse.json({
      status: 200,
      message: "Processed but no matching user found",
    });
  }

  const userId = userData.id;
  const invoiceData = {
    user_id: userId,
    stripe_invoice_id: invoice.id,
    amount_paid_cents: status === "succeeded" ? invoice.amount_paid : undefined,
    currency: invoice.currency,
    status,
  };

  const { data, error } = await adminSupabase
    .from("stripe_invoices")
    .insert([invoiceData]);
  if (error) {
    console.error(
      `[Stripe route.ts] Error inserting invoice (payment ${status}):`,
      error
    );
    return NextResponse.json({
      status: 500,
      error: `Error inserting invoice ( payement${status})`,
    });
  }
  return NextResponse.json({
    status: 200,
    message: `invoice paayment ${status}`,
    data,
  });
}
