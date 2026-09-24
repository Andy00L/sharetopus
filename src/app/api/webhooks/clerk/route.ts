// app/api/webhooks/clerk/route.ts
import { deleteSupabaseFileAction } from "@/actions/server/data/storageFiles/deleteSupabaseFileAction";
import { db, runQuery } from "@/db/client";
import { principals, users } from "@/db/schema";
import stripe from "@/lib/stripe";
import { WebhookEvent } from "@clerk/backend";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import Stripe from "stripe";
import { Webhook } from "svix";

export async function POST(req: Request) {
  const webhookSecret =
    process.env.NODE_ENV === "production"
      ? process.env.CLERK_WEBHOOK_SECRET
      : process.env.CLERK_WEBHOOK_SECRET_DEV;

  if (!webhookSecret) {
    console.error("[Clerk Routes]: Clerk webhook secret is not set");
    return new Response("Webhook configuration missing", { status: 500 });
  }

  const headerPayload = await headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response("Missing signature headers", { status: 400 });
  }

  // Read the RAW request body. Svix signs the exact bytes Clerk sent, so
  // the verified payload must be those bytes. The previous JSON.parse then
  // JSON.stringify round trip re-serialized them, and re-serialization is
  // not byte-identical: Go's encoding/json (Clerk's backend) emits the
  // ampersand and the angle brackets as six-character unicode escapes,
  // which JSON.stringify writes back as the literal characters. The
  // resulting string no longer matches the signature, so any event
  // carrying one of them (an avatar URL with a query string, for
  // instance) was rejected on every delivery and every retry, and the
  // user never landed in Supabase.
  // sourceRef: docs.svix.com webhook verification (raw body required).
  const rawBody = await req.text();

  const wh = new Webhook(webhookSecret);
  let evt: WebhookEvent;

  try {
    evt = wh.verify(rawBody, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    }) as WebhookEvent;
  } catch (err) {
    console.error("[Clerk Routes]: Webhook verification failed:", err);
    return new Response("Signature verification failed", {
      status: 400,
    });
  }

  const eventType = evt.type;
  const data = evt.data;

  try {
    switch (eventType) {
      case "user.created":
        await handleUserCreated(data as ClerkUserData);
        break;
      case "user.updated":
        await handleUserUpdated(data as ClerkUserData);
        break;
      case "user.deleted":
        await handleUserDeleted(data as { id: string });
        break;
      default:
        console.log("[Clerk Routes]: Unhandled event:", eventType);
        break;
    }

    return new Response("Webhook processed", { status: 200 });
  } catch (error) {
    // The handlers throw when a step fails. The 500 makes Svix deliver the
    // event again, and every handler is safe to run twice.
    console.error(
      "[Clerk Routes]: Webhook processing failed:",
      error,
    );
    return new Response("Webhook processing failed", {
      status: 500,
    });
  }
}

interface ClerkEmailAddress {
  email_address: string;
  id: string;
  verification: {
    status: string;
    strategy: string;
  } | null;
  object: string;
}

interface ClerkUserData {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  email_addresses?: ClerkEmailAddress[];
  primary_email_address_id?: string | null;
  username?: string | null;
  object: string;
}

/**
 * Creates the Stripe customer, then the principals and users rows. A failed
 * step throws so Svix retries, after deleting the customer made for a row
 * that was not written. A users row that already exists (ensureUserExists
 * got there first) ends the event: nothing is left to do.
 */
async function handleUserCreated(data: ClerkUserData) {
  const userId = data.id;
  const email = data.email_addresses?.[0]?.email_address;
  // Extra fields from Clerk
  const username = data.username ?? null;
  // Determine first and last names. Fall back on full_name when the individual fields are absent.
  const firstName =
    data.first_name ??
    (data.full_name ? data.full_name.split(" ")[0] : username);
  const lastName =
    data.last_name ??
    (data.full_name ? data.full_name.split(" ").slice(1).join(" ") : "");

  if (!email) {
    console.error("[Clerk Routes]: No email for user, aborting creation");
    return;
  }

  const customer = await stripe.customers.create({
    email: email,
    metadata: {
      userId: userId,
    },
  });
  const stripeCustomerId = customer.id;
  console.log(
    `[Clerk Routes]: Stripe customer created for user ${userId}: ${stripeCustomerId}`,
  );

  // Upsert into principals first (users.id FK requires it)
  const { error: principalError } = await runQuery(
    db
      .insert(principals)
      .values({ id: userId, kind: "clerk" })
      .onConflictDoNothing({ target: principals.id }),
  );

  if (principalError) {
    await rollBackStripeCustomer(stripeCustomerId);
    throw new Error(`Principal upsert failed: ${principalError.message}`);
  }

  const { error: insertError } = await runQuery(
    db.insert(users).values({
      id: userId,
      email,
      first_name: firstName,
      last_name: lastName,
      stripe_customer_id: stripeCustomerId,
    }),
  );

  if (insertError) {
    await rollBackStripeCustomer(stripeCustomerId);
    // 23505 is a unique violation: the users row already exists.
    if (insertError.code === "23505") {
      console.log(`[Clerk Routes]: User ${userId} already exists`);
      return;
    }
    throw new Error(`User insert failed: ${insertError.message}`);
  }
}

/**
 * Deletes a Stripe customer created for a users row that was not written.
 * Logged, not thrown: the caller already holds the error that matters.
 */
async function rollBackStripeCustomer(stripeCustomerId: string) {
  try {
    await stripe.customers.del(stripeCustomerId);
    console.log(
      `[Clerk Routes]: Stripe customer ${stripeCustomerId} deleted after a failed user write`,
    );
  } catch (deleteError) {
    console.error(
      `[Clerk Routes]: Stripe customer ${stripeCustomerId} could not be rolled back:`,
      deleteError,
    );
  }
}

/** Copies the name and email to the users row and the email to Stripe. A failed step throws so Svix retries. */
async function handleUserUpdated(data: ClerkUserData) {
  const userId = data.id;
  const email = data.email_addresses?.[0]?.email_address;

  const nameParts =
    data.first_name && data.last_name
      ? [data.first_name, data.last_name]
      : (data.full_name ?? "").split(" ");

  const firstName = nameParts[0] || null;
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

  // An undefined email (no address on the Clerk user) leaves the column
  // untouched: Drizzle drops undefined keys from the SET list. RETURNING
  // hands back the Stripe customer to update, and nothing for an unknown user.
  const { data: updatedRows, error } = await runQuery(
    db
      .update(users)
      .set({
        email,
        first_name: firstName,
        last_name: lastName,
        updated_at: new Date().toISOString(),
      })
      .where(eq(users.id, userId))
      .returning({ stripe_customer_id: users.stripe_customer_id }),
  );

  if (error) {
    throw new Error(`User update failed: ${error.message}`);
  }

  const stripeCustomerId = updatedRows[0]?.stripe_customer_id;
  if (stripeCustomerId) {
    await stripe.customers.update(stripeCustomerId, { email: email });
    console.log(`[Clerk Routes]: Stripe customer updated: ${stripeCustomerId}`);
  }
}

/**
 * Deletes the Stripe customer, then the users row (its cascade removes the
 * rest), then the storage folder. The customer goes first because the users
 * row is the only place its id is kept: a failure leaves the row, and the
 * retry finds the id again. Deleting the row first and failing on Stripe
 * left a live customer, subscriptions included, nothing could reach.
 */
async function handleUserDeleted(data: { id: string }) {
  const userId = data.id;
  const { data: userRows, error: lookupError } = await runQuery(
    db
      .select({ stripe_customer_id: users.stripe_customer_id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
  );

  if (lookupError) {
    throw new Error(`User lookup failed: ${lookupError.message}`);
  }

  const stripeCustomerId = userRows[0]?.stripe_customer_id;
  if (stripeCustomerId) {
    await deleteStripeCustomer(stripeCustomerId);
  }

  const { error: deleteError } = await runQuery(
    db.delete(users).where(eq(users.id, userId)),
  );

  if (deleteError) {
    throw new Error(`User delete failed: ${deleteError.message}`);
  }

  // Delete user folder from storage
  const { success, message } = await deleteSupabaseFileAction(
    userId,
    null,
    true,
    process.env.CRON_SECRET_KEY,
  );
  if (!success) {
    console.error(
      "[Clerk Routes]: Storage folder delete failed for user:",
      message,
    );
  } else {
    console.log(
      `[Clerk Routes]: Storage folder deleted for user ${userId}`,
    );
  }
}

/**
 * Deletes a Stripe customer, which also cancels its subscriptions. A customer
 * Stripe no longer has (a retry after an earlier success) counts as deleted;
 * any other failure throws.
 */
async function deleteStripeCustomer(stripeCustomerId: string) {
  try {
    await stripe.customers.del(stripeCustomerId);
    console.log(`[Clerk Routes]: Stripe customer deleted: ${stripeCustomerId}`);
  } catch (stripeError) {
    const isAlreadyDeleted =
      stripeError instanceof Stripe.errors.StripeInvalidRequestError &&
      stripeError.code === "resource_missing";
    if (!isAlreadyDeleted) throw stripeError;
    console.log(
      `[Clerk Routes]: Stripe customer ${stripeCustomerId} was already deleted`,
    );
  }
}
