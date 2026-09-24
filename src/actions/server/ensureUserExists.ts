import "server-only";
import { currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { after } from "next/server";
import type Stripe from "stripe";
import { db, runQuery } from "@/db/client";
import { principals, stripe_subscriptions, users } from "@/db/schema";
import {
  recordInvoicePayment,
  type InvoicePaymentOutcome,
} from "@/actions/server/stripe/recordInvoicePayment";
import { toSubscriptionRow } from "@/actions/server/stripe/toSubscriptionRow";
import { invalidateCachedSubscription } from "@/lib/mcp/auth/resolvers/subscriptionCache";
import { REFERRAL_COOKIE_NAME } from "@/lib/referral/referralRules";
import stripe from "@/lib/stripe";
import { recordReferralOnSignup } from "@/actions/server/referral/recordReferralOnSignup";

/**
 * Ensures the authenticated Clerk user exists in Supabase and Stripe.
 * Also syncs any Stripe subscriptions missing from Supabase.
 * Covers cases where webhooks don't arrive (e.g. dev mode without ngrok).
 */
export async function ensureUserExists() {
  const user = await currentUser();
  if (!user) return;

  // Check if user already exists in Supabase
  const { data: existingUserRows, error: lookupError } = await runQuery(
    db
      .select({ stripe_customer_id: users.stripe_customer_id })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1)
  );

  // A failed lookup says nothing about the row. Reading it as "no user"
  // created a second Stripe customer for an existing user; the next page
  // load checks again.
  if (lookupError) {
    console.error(
      `[ensureUserExists] User lookup failed for ${user.id}:`,
      lookupError.message
    );
    return;
  }

  const existingUser = existingUserRows[0];
  if (existingUser) {
    // User exists, sync subscriptions + invoices if needed
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

  if (!email) {
    console.error("[ensureUserExists] No email found for user, aborting");
    return;
  }

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
    return;
  }

  // Upsert into principals first (users.id FK requires it)
  const { error: principalError } = await runQuery(
    db
      .insert(principals)
      .values({ id: user.id, kind: "clerk" })
      .onConflictDoNothing({ target: principals.id })
  );

  if (principalError) {
    console.error("[ensureUserExists] Erreur upsert principal:", principalError);
    // Roll back Stripe customer
    try {
      await stripe.customers.del(stripeCustomerId);
    } catch (deleteError) {
      console.error("[ensureUserExists] Erreur rollback Stripe:", deleteError);
    }
    return;
  }

  // Insert user into Supabase
  const { error } = await runQuery(
    db.insert(users).values({
      id: user.id,
      email,
      first_name: user.firstName ?? user.username ?? null,
      last_name: user.lastName ?? null,
      stripe_customer_id: stripeCustomerId,
    })
  );

  if (error) {
    console.error("[ensureUserExists] Erreur insertion Supabase:", error);
    try {
      await stripe.customers.del(stripeCustomerId);
    } catch (deleteError) {
      console.error(
        "[ensureUserExists] Erreur rollback Stripe:",
        deleteError
      );
    }
  } else {
    console.log(
      `[ensureUserExists] User ${user.id} synced to Supabase + Stripe`
    );
    // Sync subscriptions + invoices for the newly created user
    await Promise.all([
      syncStripeSubscriptions(user.id, stripeCustomerId),
      syncStripeInvoices(user.id, stripeCustomerId),
    ]);

    // Referral attribution, first creation only. The cookie is read now,
    // while the request is live; the attribution runs after the response,
    // and after() keeps the serverless function alive until it finishes
    // (a floating promise can be frozen mid-write). Best-effort: it logs its
    // own failures and never blocks user creation.
    const referralCode = (await cookies()).get(REFERRAL_COOKIE_NAME)?.value;
    if (referralCode) {
      after(() =>
        recordReferralOnSignup({ newUserId: user.id, newUserEmail: email, referralCode }),
      );
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
      const subscriptionData = toSubscriptionRow(
        subscription,
        userId,
        stripeCustomerId
      );

      // Check if this subscription already exists in Supabase
      const { data: existingRows, error: lookupError } = await runQuery(
        db
          .select({ status: stripe_subscriptions.status })
          .from(stripe_subscriptions)
          .where(
            eq(stripe_subscriptions.stripe_subscription_id, subscription.id)
          )
          .limit(1)
      );

      // Unknown is not missing: an insert here would collide with the row
      // that may well exist. The next page load syncs it.
      if (lookupError) {
        console.error(
          `[ensureUserExists] Lookup failed for subscription ${subscription.id}:`,
          lookupError.message
        );
        continue;
      }

      const existing = existingRows[0];
      if (existing) {
        // Update status if it changed (mirrors webhook subscription.updated / .deleted)
        if (existing.status !== subscription.status) {
          const { error } = await runQuery(
            db
              .update(stripe_subscriptions)
              .set(subscriptionData)
              .where(
                eq(stripe_subscriptions.stripe_subscription_id, subscription.id)
              )
          );

          if (error) {
            console.error(
              `[ensureUserExists] Erreur update subscription ${subscription.id}:`,
              error
            );
          } else {
            invalidateCachedSubscription(userId);
            console.log(
              `[ensureUserExists] Subscription ${subscription.id} updated: ${existing.status} → ${subscription.status}`
            );
          }
        }
        continue;
      }

      // Insert new subscription (mirrors webhook subscription.created)
      const { error } = await runQuery(
        db.insert(stripe_subscriptions).values(subscriptionData)
      );

      if (error) {
        console.error(
          `[ensureUserExists] Erreur sync subscription ${subscription.id}:`,
          error
        );
      } else {
        invalidateCachedSubscription(userId);
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
 * Syncs Stripe invoices into the stripe_invoices table through the writer
 * the webhook's invoice.payment_succeeded / .payment_failed use, so an
 * invoice paid after a failed attempt ends up succeeded here too.
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

    for (const invoice of invoices.data) {
      const outcome = toPaymentOutcome(invoice);
      if (!invoice.id || !outcome) continue;

      const recorded = await recordInvoicePayment({
        userId,
        stripeInvoiceId: invoice.id,
        outcome,
        amountPaidCents: invoice.amount_paid,
        currency: invoice.currency,
      });
      if (!recorded.ok) {
        console.error(`[ensureUserExists] Could not sync invoice ${invoice.id}`);
      }
    }
  } catch (err) {
    console.error("[ensureUserExists] Erreur sync invoices:", err);
  }
}

/**
 * The payment outcome an invoice shows: paid, or tried and failed. Drafts,
 * voided invoices and open ones not charged yet have none. This sync used to
 * record every unpaid invoice as failed, a draft included.
 */
function toPaymentOutcome(invoice: Stripe.Invoice): InvoicePaymentOutcome | null {
  if (invoice.status === "paid") return "succeeded";
  if (invoice.status === "uncollectible") return "failed";
  if (invoice.status === "open" && invoice.attempted) return "failed";
  return null;
}
