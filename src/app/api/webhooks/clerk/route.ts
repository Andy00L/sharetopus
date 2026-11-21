import { deleteSupabaseFile } from "@/actions/server/data/storageFiles/deleteSupabaseFile";
import { db, runQuery } from "@/db/client";
import { principals, users } from "@/db/schema";
import stripe from "@/lib/stripe";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import Stripe from "stripe";
import { Webhook } from "svix";
import { z } from "zod";

export async function POST(req: Request) {
  const webhookSecret =
    process.env.NODE_ENV === "production"
      ? process.env.CLERK_WEBHOOK_SECRET
      : process.env.CLERK_WEBHOOK_SECRET_DEV;

  if (!webhookSecret) {
    console.error("[POST] Clerk webhook secret is not set");
    return new Response("Webhook configuration missing", { status: 500 });
  }

  const headerPayload = await headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response("Missing signature headers", { status: 400 });
  }

  // Svix verification needs the raw request body; a JSON parse and stringify
  // round trip breaks the signature:
  // https://docs.svix.com/receiving/verifying-payloads/how
  const rawBody = await req.text();

  const svixWebhook = new Webhook(webhookSecret);
  let verifiedPayload: unknown;

  try {
    verifiedPayload = svixWebhook.verify(rawBody, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    });
  } catch (err) {
    console.error("[POST] Webhook verification failed:", err);
    return new Response("Signature verification failed", {
      status: 400,
    });
  }

  const envelopeResult = ClerkEventEnvelopeSchema.safeParse(verifiedPayload);
  if (!envelopeResult.success) {
    return respondMalformedEvent("envelope");
  }
  const { type: eventType, data } = envelopeResult.data;

  try {
    switch (eventType) {
      case "user.created": {
        const userResult = ClerkUserDataSchema.safeParse(data);
        if (!userResult.success) return respondMalformedEvent(eventType);
        await handleUserCreated(userResult.data);
        break;
      }
      case "user.updated": {
        const userResult = ClerkUserDataSchema.safeParse(data);
        if (!userResult.success) return respondMalformedEvent(eventType);
        await handleUserUpdated(userResult.data);
        break;
      }
      case "user.deleted": {
        const deletedResult = ClerkDeletedUserSchema.safeParse(data);
        if (!deletedResult.success) return respondMalformedEvent(eventType);
        await handleUserDeleted(deletedResult.data);
        break;
      }
      default:
        console.log("[POST] Unhandled event:", eventType);
        break;
    }

    return new Response("Webhook processed", { status: 200 });
  } catch (error) {
    console.error(
      "[POST] Webhook processing failed:",
      error,
    );
    return new Response("Webhook processing failed", {
      status: 500,
    });
  }
}

const ClerkEventEnvelopeSchema = z.object({
  type: z.string(),
  data: z.unknown(),
});

const ClerkUserDataSchema = z.object({
  id: z.string(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  full_name: z.string().nullish(),
  email_addresses: z.array(z.object({ email_address: z.string() })).optional(),
  username: z.string().nullish(),
});

type ClerkUserData = z.infer<typeof ClerkUserDataSchema>;

const ClerkDeletedUserSchema = z.object({ id: z.string() });

function respondMalformedEvent(eventLabel: string): Response {
  console.error(`[respondMalformedEvent] Clerk ${eventLabel} payload failed validation`);
  return new Response("Invalid webhook payload", { status: 400 });
}

async function handleUserCreated(data: ClerkUserData) {
  const userId = data.id;
  if (await hasUserRow(userId)) {
    console.log(`[handleUserCreated] User ${userId} already exists`);
    return;
  }

  const email = data.email_addresses?.[0]?.email_address;
  const username = data.username ?? null;
  const firstName =
    data.first_name ??
    (data.full_name ? data.full_name.split(" ")[0] : username);
  const lastName =
    data.last_name ??
    (data.full_name ? data.full_name.split(" ").slice(1).join(" ") : "");

  if (!email) {
    console.error("[handleUserCreated] No email for user, aborting creation");
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
    `[handleUserCreated] Stripe customer created for user ${userId}: ${stripeCustomerId}`,
  );

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
    // 23505 unique_violation: the users row already exists:
    // https://www.postgresql.org/docs/current/errcodes-appendix.html
    if (insertError.code === "23505") {
      console.log(`[handleUserCreated] User ${userId} already exists`);
      return;
    }
    throw new Error(`User insert failed: ${insertError.message}`);
  }
}

async function hasUserRow(userId: string): Promise<boolean> {
  const { data: userRows, error } = await runQuery(
    db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1),
  );
  if (error) {
    throw new Error(`User existence check failed: ${error.message}`);
  }
  return userRows.length > 0;
}

async function rollBackStripeCustomer(stripeCustomerId: string) {
  try {
    await stripe.customers.del(stripeCustomerId);
    console.log(
      `[rollBackStripeCustomer] Stripe customer ${stripeCustomerId} deleted after a failed user write`,
    );
  } catch (deleteError) {
    console.error(
      `[rollBackStripeCustomer] Stripe customer ${stripeCustomerId} could not be rolled back:`,
      deleteError,
    );
  }
}

async function handleUserUpdated(data: ClerkUserData) {
  const userId = data.id;
  const email = data.email_addresses?.[0]?.email_address;

  const nameParts =
    data.first_name && data.last_name
      ? [data.first_name, data.last_name]
      : (data.full_name ?? "").split(" ");

  const firstName = nameParts[0] || null;
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

  // Drizzle drops undefined keys from the SET list, so an undefined email leaves
  // the column untouched: mapUpdateSet in node_modules/drizzle-orm/utils.js.
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
    console.log(`[handleUserUpdated] Stripe customer updated: ${stripeCustomerId}`);
  }
}

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

  const { success, message } = await deleteSupabaseFile(userId, null, true);
  if (!success) {
    console.error(
      `[handleUserDeleted] Storage folder delete failed for user ${userId}: ${message}`,
    );
  } else {
    console.log(`[handleUserDeleted] Storage folder deleted for user ${userId}`);
  }
}

// Deleting a customer "also immediately cancels any active subscriptions on the
// customer": https://docs.stripe.com/api/customers/delete
async function deleteStripeCustomer(stripeCustomerId: string) {
  try {
    await stripe.customers.del(stripeCustomerId);
    console.log(`[deleteStripeCustomer] Stripe customer deleted: ${stripeCustomerId}`);
  } catch (stripeError) {
    const isAlreadyDeleted =
      stripeError instanceof Stripe.errors.StripeInvalidRequestError &&
      stripeError.code === "resource_missing";
    if (!isAlreadyDeleted) throw stripeError;
    console.log(
      `[deleteStripeCustomer] Stripe customer ${stripeCustomerId} was already deleted`,
    );
  }
}
