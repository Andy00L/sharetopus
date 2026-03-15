import "server-only";
import { currentUser } from "@clerk/nextjs/server";
import { adminSupabase } from "@/actions/api/adminSupabase";
import stripe from "@/lib/stripe";

/**
 * Ensures the authenticated Clerk user exists in Supabase and Stripe.
 * Also syncs any Stripe subscriptions missing from Supabase.
 * Covers cases where webhooks don't arrive (e.g. dev mode without ngrok).
 */
export async function ensureUserExists() {
  const user = await currentUser();
  if (!user) return;

  // Check if user already exists in Supabase
  const { data: existingUser } = await adminSupabase
    .from("users")
    .select("id, stripe_customer_id")
    .eq("id", user.id)
    .single();

  if (existingUser) {
    // User exists — sync subscriptions + invoices if needed
    if (existingUser.stripe_customer_id) {
      await Promise.all([
        syncStripeSubscriptions(user.id, existingUser.stripe_customer_id),
        syncStripeInvoices(user.id, existingUser.stripe_customer_id),
      ]);
    }
    return;
  }

  // Create Stripe customer
  let stripeCustomerId: string | null = null;
  const email = user.emailAddresses?.[0]?.emailAddress;

  try {
    const customer = await stripe.customers.create({
      email,
      metadata: { userId: user.id },
    });
    stripeCustomerId = customer.id;
    console.log(
      `[ensureUserExists] Stripe customer created for user ${user.id}: ${stripeCustomerId}`
    );
  } catch (stripeError) {
    console.error(
      "[ensureUserExists] Erreur création client Stripe:",
      stripeError
    );
  }

  // Insert user into Supabase
  const { error } = await adminSupabase.from("users").insert({
    id: user.id,
    email,
    first_name: user.firstName ?? user.username ?? null,
    last_name: user.lastName ?? null,
    stripe_customer_id: stripeCustomerId,
  });

  if (error) {
    console.error("[ensureUserExists] Erreur insertion Supabase:", error);
    if (stripeCustomerId) {
      try {
        await stripe.customers.del(stripeCustomerId);
      } catch (deleteError) {
        console.error(
          "[ensureUserExists] Erreur rollback Stripe:",
          deleteError
        );
      }
    }
  } else {
    console.log(
      `[ensureUserExists] User ${user.id} synced to Supabase + Stripe`
    );
    // Sync subscriptions + invoices for the newly created user
    if (stripeCustomerId) {
      await Promise.all([
        syncStripeSubscriptions(user.id, stripeCustomerId),
        syncStripeInvoices(user.id, stripeCustomerId),
      ]);
    }
  }
}

/**
 * Syncs all Stripe subscriptions into the stripe_subscriptions table.
 * Inserts missing subscriptions AND updates status of existing ones.
 * Mirrors the Stripe webhook behavior: subscription.created, .updated, .deleted
 */
async function syncStripeSubscriptions(
  userId: string,
  stripeCustomerId: string
) {
  try {
    const subscriptions = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: "all",
    });

    if (subscriptions.data.length === 0) return;

    for (const subscription of subscriptions.data) {
      const subscriptionData = {
        user_id: userId,
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: subscription.id,
        status: subscription.status,
        start_date: new Date(subscription.created * 1000).toISOString(),
        end_date: new Date(
          Math.min(
            ...subscription.items.data.map((i) => i.current_period_end)
          ) * 1000
        ).toISOString(),
        plan: subscription.items.data[0]?.plan.id,
      };

      // Check if this subscription already exists in Supabase
      const { data: existing } = await adminSupabase
        .from("stripe_subscriptions")
        .select("id, status")
        .eq("stripe_subscription_id", subscription.id)
        .single();

      if (existing) {
        // Update status if it changed (mirrors webhook subscription.updated / .deleted)
        if (existing.status !== subscription.status) {
          const { error } = await adminSupabase
            .from("stripe_subscriptions")
            .update({
              status: subscription.status,
              end_date: subscriptionData.end_date,
              plan: subscriptionData.plan,
            })
            .eq("stripe_subscription_id", subscription.id);

          if (error) {
            console.error(
              `[ensureUserExists] Erreur update subscription ${subscription.id}:`,
              error
            );
          } else {
            console.log(
              `[ensureUserExists] Subscription ${subscription.id} updated: ${existing.status} → ${subscription.status}`
            );
          }
        }
        continue;
      }

      // Insert new subscription (mirrors webhook subscription.created)
      const { error } = await adminSupabase
        .from("stripe_subscriptions")
        .insert(subscriptionData);

      if (error) {
        console.error(
          `[ensureUserExists] Erreur sync subscription ${subscription.id}:`,
          error
        );
      } else {
        console.log(
          `[ensureUserExists] Subscription ${subscription.id} synced for user ${userId}`
        );
      }
    }
  } catch (err) {
    console.error("[ensureUserExists] Erreur sync subscriptions:", err);
  }
}

/**
 * Syncs Stripe invoices into the stripe_invoices table.
 * Mirrors the Stripe webhook behavior: invoice.payment_succeeded / .payment_failed
 */
async function syncStripeInvoices(
  userId: string,
  stripeCustomerId: string
) {
  try {
    const invoices = await stripe.invoices.list({
      customer: stripeCustomerId,
      limit: 20,
    });

    if (invoices.data.length === 0) return;

    for (const invoice of invoices.data) {
      // Check if this invoice already exists in Supabase
      const { data: existing } = await adminSupabase
        .from("stripe_invoices")
        .select("id")
        .eq("stripe_invoice_id", invoice.id)
        .single();

      if (existing) continue;

      const status = invoice.status === "paid" ? "succeeded" : "failed";

      const { error } = await adminSupabase
        .from("stripe_invoices")
        .insert({
          user_id: userId,
          stripe_invoice_id: invoice.id,
          amount_paid: status === "succeeded" ? (invoice.amount_paid ?? 0) / 100 : undefined,
          currency: invoice.currency,
          status,
        });

      if (error) {
        console.error(
          `[ensureUserExists] Erreur sync invoice ${invoice.id}:`,
          error
        );
      } else {
        console.log(
          `[ensureUserExists] Invoice ${invoice.id} synced for user ${userId}`
        );
      }
    }
  } catch (err) {
    console.error("[ensureUserExists] Erreur sync invoices:", err);
  }
}
