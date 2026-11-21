import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { after } from "next/server";
import { db, runQuery } from "@/db/client";
import { principals, users } from "@/db/schema";
import { REFERRAL_COOKIE_NAME } from "@/lib/referral/referralRules";
import stripe from "@/lib/stripe";
import { recordReferralOnSignup } from "@/actions/server/referral/recordReferralOnSignup";

export async function ensureUserExists() {
  const { userId } = await auth();
  if (!userId) return;

  const { data: existingUserRows, error: lookupError } = await runQuery(
    db
      .select({ id: users.id })
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

  if (existingUserRows.length > 0) return;

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
