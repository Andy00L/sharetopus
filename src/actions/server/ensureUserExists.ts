import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { after } from "next/server";
import { db, runQuery } from "@/db/client";
import { principals, users } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { referralSignupEvent } from "@/inngest/events/referralSignup";
import { REFERRAL_CODE_PATTERN, REFERRAL_COOKIE_NAME } from "@/lib/referral/referralRules";
import stripe from "@/lib/stripe";

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
      "[ensureUserExists] Stripe customer creation failed:",
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
    console.error("[ensureUserExists] Principal upsert failed:", principalError);
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
    console.error("[ensureUserExists] User insert failed:", error);
    await rollBackStripeCustomer(stripeCustomerId);
    return;
  }

  console.log(`[ensureUserExists] User ${user.id} synced to the database and Stripe`);

  // Cookies are readable only during the request; after() keeps the function
  // alive until the send finishes:
  // https://nextjs.org/docs/app/api-reference/functions/after
  const referralCode = (await cookies()).get(REFERRAL_COOKIE_NAME)?.value;
  if (referralCode && REFERRAL_CODE_PATTERN.test(referralCode)) {
    after(() => sendReferralSignupEvent(user.id, referralCode));
  }
}

async function sendReferralSignupEvent(newUserId: string, referralCode: string): Promise<void> {
  try {
    // Inngest drops a repeated event id for 24 hours:
    // https://www.inngest.com/docs/guides/handling-idempotency
    await inngest.send(
      referralSignupEvent.create(
        { new_user_id: newUserId, referral_code: referralCode },
        { id: `referral-signup-${newUserId}` },
      ),
    );
  } catch (sendError) {
    console.error(
      `[sendReferralSignupEvent] Referral for user ${newUserId} not sent:`,
      sendError instanceof Error ? sendError.message : String(sendError),
    );
  }
}

async function rollBackStripeCustomer(stripeCustomerId: string) {
  try {
    await stripe.customers.del(stripeCustomerId);
  } catch (deleteError) {
    console.error("[rollBackStripeCustomer] Stripe customer rollback failed:", deleteError);
  }
}
