import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { after } from "next/server";
import type Stripe from "stripe";
import { redis } from "@/actions/api/upstash";
import { db, runQuery } from "@/db/client";
import { principals, stripe_subscriptions, users } from "@/db/schema";
import {
  recordInvoicePayments,
  type InvoicePayment,
  type InvoicePaymentOutcome,
} from "@/actions/server/stripe/recordInvoicePayment";
import { toSubscriptionRow } from "@/actions/server/stripe/toSubscriptionRow";
import { invalidateCachedSubscription } from "@/lib/mcp/auth/resolvers/subscriptionCache";
import { REFERRAL_COOKIE_NAME } from "@/lib/referral/referralRules";
import stripe from "@/lib/stripe";
import { recordReferralOnSignup } from "@/actions/server/referral/recordReferralOnSignup";

const STRIPE_SYNC_INTERVAL_SECONDS = 600;

const STRIPE_SYNC_INVOICE_LIMIT = 20;

export async function ensureUserExists() {
  const { userId } = await auth();
  if (!userId) return;

  const { data: existingUserRows, error: lookupError } = await runQuery(
    db
      .select({ stripe_customer_id: users.stripe_customer_id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  );

  if (lookupError) {
    console.error(
      `[ensureUserExists] User lookup failed for ${userId}:`,
      lookupError.message
    );
    return;
  }

  const existingUser = existingUserRows[0];
  if (existingUser) {
    const stripeCustomerId = existingUser.stripe_customer_id;
    after(() => syncStripeAccountIfDue(userId, stripeCustomerId));
    return;
  }

  await createUserWithStripeCustomer();
}

async function createUserWithStripeCustomer() {
  const user = await currentUser();
  if (!user) return;

  const email = user.emailAddresses?.[0]?.emailAddress;
  if (!email) {
    console.error("[ensureUserExists] No email found for user, aborting");
    return;
  }

  let stripeCustomerId: string;
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

  const { error: principalError } = await runQuery(
    db
      .insert(principals)
      .values({ id: user.id, kind: "clerk" })
      .onConflictDoNothing({ target: principals.id })
  );

  if (principalError) {
    console.error("[ensureUserExists] Erreur upsert principal:", principalError);
    await rollBackStripeCustomer(stripeCustomerId);
    return;
  }

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
    await rollBackStripeCustomer(stripeCustomerId);
    return;
  }

  console.log(`[ensureUserExists] User ${user.id} synced to Supabase + Stripe`);

  // The cookie is read now, while the request is live; the attribution runs
  // after the response, and after() keeps the serverless function alive
  // until it finishes (a floating promise can be frozen mid-write).
  const referralCode = (await cookies()).get(REFERRAL_COOKIE_NAME)?.value;
  if (referralCode) {
    after(() =>
      recordReferralOnSignup({ newUserId: user.id, newUserEmail: email, referralCode }),
    );
  }
}

async function rollBackStripeCustomer(stripeCustomerId: string) {
  try {
    await stripe.customers.del(stripeCustomerId);
  } catch (deleteError) {
    console.error("[rollBackStripeCustomer] Erreur rollback Stripe:", deleteError);
  }
}

async function syncStripeAccountIfDue(userId: string, stripeCustomerId: string) {
  if (!(await claimStripeSyncSlot(userId))) return;
  await Promise.all([
    syncStripeSubscriptions(userId, stripeCustomerId),
    syncStripeInvoices(userId, stripeCustomerId),
  ]);
}

async function claimStripeSyncSlot(userId: string): Promise<boolean> {
  try {
    const reply = await redis.set(`stripe_sync:${userId}`, "1", {
      nx: true,
      ex: STRIPE_SYNC_INTERVAL_SECONDS,
    });
    return reply === "OK";
  } catch (redisError) {
    console.error(
      `[claimStripeSyncSlot] Throttle unavailable for ${userId}, syncing anyway:`,
      redisError instanceof Error ? redisError.message : redisError
    );
    return true;
  }
}

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

    const subscriptionRows = subscriptions.data.map((subscription) =>
      toSubscriptionRow(subscription, userId, stripeCustomerId)
    );

    const { data: changedRows, error } = await runQuery(
      db
        .insert(stripe_subscriptions)
        .values(subscriptionRows)
        .onConflictDoUpdate({
          target: stripe_subscriptions.stripe_subscription_id,
          set: {
            user_id: sql`excluded.user_id`,
            stripe_customer_id: sql`excluded.stripe_customer_id`,
            status: sql`excluded.status`,
            start_date: sql`excluded.start_date`,
            end_date: sql`excluded.end_date`,
            current_period_end: sql`excluded.current_period_end`,
            stripe_price_id: sql`excluded.stripe_price_id`,
          },
          setWhere: sql`(${stripe_subscriptions.status}, ${stripe_subscriptions.stripe_price_id}, ${stripe_subscriptions.current_period_end}) is distinct from (excluded.status, excluded.stripe_price_id, excluded.current_period_end)`,
        })
        .returning({
          stripe_subscription_id: stripe_subscriptions.stripe_subscription_id,
          status: stripe_subscriptions.status,
        })
    );

    if (error) {
      console.error(
        `[syncStripeSubscriptions] Upsert failed for user ${userId}:`,
        error.message
      );
      return;
    }

    if (changedRows.length > 0) {
      invalidateCachedSubscription(userId);
      const changeSummary = changedRows
        .map((changedRow) => `${changedRow.stripe_subscription_id}=${changedRow.status}`)
        .join(", ");
      console.log(
        `[syncStripeSubscriptions] Synced for user ${userId}: ${changeSummary}`
      );
    }
  } catch (syncError) {
    console.error("[syncStripeSubscriptions] Erreur sync subscriptions:", syncError);
  }
}

async function syncStripeInvoices(
  userId: string,
  stripeCustomerId: string
) {
  try {
    const invoices = await stripe.invoices.list({
      customer: stripeCustomerId,
      limit: STRIPE_SYNC_INVOICE_LIMIT,
    });

    const payments: InvoicePayment[] = invoices.data.flatMap((invoice) => {
      const outcome = toPaymentOutcome(invoice);
      if (!invoice.id || !outcome) return [];
      return [
        {
          userId,
          stripeInvoiceId: invoice.id,
          outcome,
          amountPaidCents: invoice.amount_paid,
          currency: invoice.currency,
        },
      ];
    });
    if (payments.length === 0) return;

    const recorded = await recordInvoicePayments(payments);
    if (!recorded.ok) {
      console.error(`[syncStripeInvoices] Could not sync invoices for user ${userId}`);
    }
  } catch (syncError) {
    console.error("[syncStripeInvoices] Erreur sync invoices:", syncError);
  }
}

function toPaymentOutcome(invoice: Stripe.Invoice): InvoicePaymentOutcome | null {
  if (invoice.status === "paid") return "succeeded";
  if (invoice.status === "uncollectible") return "failed";
  if (invoice.status === "open" && invoice.attempted) return "failed";
  return null;
}
