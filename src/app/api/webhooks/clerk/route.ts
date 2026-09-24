// app/api/webhooks/clerk/route.ts
import { deleteSupabaseFileAction } from "@/actions/server/data/storageFiles/deleteSupabaseFileAction";
import { db, runQuery } from "@/db/client";
import { principals, users } from "@/db/schema";
import stripe from "@/lib/stripe";
import { WebhookEvent } from "@clerk/backend";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
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

async function handleUserCreated(data: ClerkUserData) {
  try {
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

    //stripe customer creation
    let stripeCustomerId: string | null = null;
    try {
      const customer = await stripe.customers.create({
        email: email,
        metadata: {
          userId: userId,
        },
      });

      stripeCustomerId = customer.id;
      console.log(
        `[Clerk Routes]: Stripe customer created for user ${userId}: ${stripeCustomerId}`,
      );
    } catch (stripeError) {
      console.error(
        "[Clerk Routes]: Stripe customer creation failed:",
        stripeError,
      );
      return;
    }

    // Upsert into principals first (users.id FK requires it)
    const { error: principalError } = await runQuery(
      db
        .insert(principals)
        .values({ id: userId, kind: "clerk" })
        .onConflictDoNothing({ target: principals.id }),
    );

    if (principalError) {
      console.error("[Clerk Routes]: Principal upsert failed:", principalError);
      try {
        await stripe.customers.del(stripeCustomerId);
      } catch (deleteError) {
        console.error(
          "[Clerk Routes]: Stripe rollback failed after principal upsert error:",
          deleteError,
        );
      }
      return;
    }

    // Insert the new user into your Supabase table.
    const { error } = await runQuery(
      db.insert(users).values({
        id: userId,
        email,
        first_name: firstName,
        last_name: lastName,
        stripe_customer_id: stripeCustomerId,
      }),
    );

    if (error) {
      console.error(
        "[Clerk Routes]: Supabase user insert failed:",
        error,
      );

      // Clean up Stripe customer if user creation failed
      try {
        await stripe.customers.del(stripeCustomerId);
        console.log(
          `[Clerk Routes]: Stripe customer ${stripeCustomerId} deleted after Supabase error`,
        );
      } catch (deleteError) {
        console.error(
          "[Clerk Routes]: Stripe customer delete failed:",
          deleteError,
        );
        throw error;
      }
    }
  } catch (error) {
    console.error("[Clerk Routes]: handleUserCreated failed:", error);
    throw error;
  }
}

async function handleUserUpdated(data: ClerkUserData) {
  try {
    const userId = data.id;
    const email = data.email_addresses?.[0]?.email_address;

    const nameParts =
      data.first_name && data.last_name
        ? [data.first_name, data.last_name]
        : (data.full_name ?? "").split(" ");

    const firstName = nameParts[0] || null;
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

    // An undefined email (no address on the Clerk user) leaves the column
    // untouched: Drizzle drops undefined keys from the SET list.
    const { error } = await runQuery(
      db
        .update(users)
        .set({
          email,
          first_name: firstName,
          last_name: lastName,
          updated_at: new Date().toISOString(),
        })
        .where(eq(users.id, userId)),
    );

    if (error) {
      console.error(
        "[Clerk Routes]: Supabase user update failed:",
        error,
      );
    }
    // Get stripe_customer_id to update Stripe
    const { data: userRows } = await runQuery(
      db
        .select({ stripe_customer_id: users.stripe_customer_id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
    );

    const userData = userRows?.[0];
    if (userData?.stripe_customer_id) {
      try {
        await stripe.customers.update(userData.stripe_customer_id, {
          email: email,
        });
        console.log(
          `[Clerk Routes]: Stripe customer updated: ${userData.stripe_customer_id}`,
        );
      } catch (stripeError) {
        console.error(
          "[Clerk Routes]: Stripe customer update failed:",
          stripeError,
        );
      }
    }
  } catch (error) {
    console.error("[Clerk Routes]: handleUserUpdated failed:", error);
    throw error;
  }
}

async function handleUserDeleted(data: { id: string }) {
  try {
    const userId = data.id;
    // Get stripe_customer_id before deleting the user
    const { data: userRows } = await runQuery(
      db
        .select({ stripe_customer_id: users.stripe_customer_id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
    );
    const userData = userRows?.[0];

    // Delete user from Supabase (this will cascade delete subscriptions)
    const { error } = await runQuery(
      db.delete(users).where(eq(users.id, userId)),
    );

    if (error) {
      console.error(
        "[Clerk Routes]: Supabase user delete failed:",
        error,
      );
    } else {
      // Delete Stripe customer if exists
      if (userData?.stripe_customer_id) {
        try {
          await stripe.customers.del(userData.stripe_customer_id);
          console.log(
            `[Clerk Routes]: Stripe customer deleted: ${userData.stripe_customer_id}`,
          );
        } catch (stripeError) {
          console.error(
            "[Clerk Routes]: Stripe customer delete failed:",
            stripeError,
          );
        }
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
  } catch (error) {
    console.error("[Clerk Routes]: handleUserDeleted failed:", error);
    throw error;
  }
}
