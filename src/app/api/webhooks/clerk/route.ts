// app/api/webhooks/clerk/route.ts
import { supabase } from "@/actions/api/supabase";
import { deleteSupabaseFileAction } from "@/actions/server/data/deleteSupabaseFileAction";
import stripe from "@/lib/stripe";
import { WebhookEvent } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { Webhook } from "svix";

export async function POST(req: Request) {
  const WEBHOOK_SECRET =
    process.env.NODE_ENV === "production"
      ? process.env.CLERK_WEBHOOK_SECRET!
      : process.env.CLERK_WEBHOOK_SECRET_DEV!;

  if (!WEBHOOK_SECRET) {
    console.error(
      " [Clerk Routes] Le secret du webhook Clerk n'est pas défini"
    );
    return new Response("Configuration webhook manquante", { status: 500 });
  }

  const headerPayload = await headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response("En-têtes de signature manquants", { status: 400 });
  }

  // Récupérer le corps de la requête
  const payload = await req.json();
  const body = JSON.stringify(payload);

  // Vérifier la signature
  const wh = new Webhook(WEBHOOK_SECRET);
  let evt: WebhookEvent;

  try {
    evt = wh.verify(body, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    }) as WebhookEvent;
  } catch (err) {
    console.error("[Clerk Routes]: Erreur de vérification du webhook:", err);
    return new Response("Échec de la vérification de la signature", {
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
        console.log("[Clerk Routes]:Événement non géré:", eventType);
        break;
    }

    return new Response("Webhook traité avec succès", { status: 200 });
  } catch (error) {
    console.error(
      "[Clerk Routes]: Erreur lors du traitement du webhook:",
      error
    );
    return new Response("Erreur lors du traitement du webhook", {
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
    // Determine first and last names. Fall back on full_name if individual names aren’t available.
    const firstName =
      data.first_name ??
      (data.full_name ? data.full_name.split(" ")[0] : username);
    const lastName =
      data.last_name ??
      (data.full_name ? data.full_name.split(" ").slice(1).join(" ") : "");

    //stripe customer creation
    let stripeCustomerId: string | null = null;
    try {
      const customer = await stripe.customers.create({
        email: email,
        metadata: {
          userId: userId, // Link Stripe customer to your user
        },
      });

      stripeCustomerId = customer.id;
      console.log(
        `[Clerk Routes]: Stripe customer created for user ${userId}: ${stripeCustomerId}`
      );
    } catch (stripeError) {
      console.error(
        "[Clerk Routes]: Erreur lors de la création du client Stripe:",
        stripeError
      );
      // We'll continue with user creation even if Stripe fails
    }

    ////////////////////////////////

    // Insert the new user into your Supabase table.
    const { error } = await supabase.from("users").insert({
      id: userId,
      email,
      first_name: firstName,
      last_name: lastName,
      stripe_customer_id: stripeCustomerId,
    });

    if (error) {
      console.error(
        "[Clerk Routes]: Erreur lors de la création de l'utilisateur dans Supabase:",
        error
      );

      // Clean up Stripe customer if user creation failed
      if (stripeCustomerId) {
        try {
          await stripe.customers.del(stripeCustomerId);
          console.log(
            `[Clerk Routes]: Stripe customer ${stripeCustomerId} deleted after Supabase error`
          );
        } catch (deleteError) {
          console.error(
            "[Clerk Routes]: Erreur lors de la suppression du client Stripe:",
            deleteError
          );
          throw error;
        }
      }
    }
  } catch (error) {
    console.error("[Clerk Routes]: Erreur dans handleUserCreated:", error);
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

    const { error } = await supabase
      .from("users")
      .update({
        email,
        first_name: firstName,
        last_name: lastName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (error) {
      console.error(
        "[Clerk Routes]: Erreur lors de la mise à jour de l'utilisateur dans Supabase:",
        error
      );
    }
    // Get stripe_customer_id to update Stripe
    const { data: userData } = await supabase
      .from("users")
      .select("stripe_customer_id")
      .eq("id", userId)
      .single();

    if (userData?.stripe_customer_id) {
      try {
        await stripe.customers.update(userData.stripe_customer_id, {
          email: email,
        });
        console.log(
          `[Clerk Routes]: Client Stripe mis à jour: ${userData.stripe_customer_id}`
        );
      } catch (stripeError) {
        console.error(
          "[Clerk Routes]: Erreur mise à jour client Stripe:",
          stripeError
        );
      }
    }
  } catch (error) {
    console.error("[Clerk Routes]: Erreur dans handleUserUpdated:", error);
    throw error;
  }
}

async function handleUserDeleted(data: { id: string }) {
  try {
    const userId = data.id;
    // Get stripe_customer_id before deleting the user
    const { data: userData } = await supabase
      .from("users")
      .select("stripe_customer_id")
      .eq("id", userId)
      .single();

    // Delete user from Supabase (this will cascade delete subscriptions)
    const { error } = await supabase.from("users").delete().eq("id", userId);

    if (error) {
      console.error(
        "[Clerk Routes]: Erreur lors de la suppression de l'utilisateur dans Supabase:",
        error
      );
    } else {
      // Delete Stripe customer if exists
      if (userData?.stripe_customer_id) {
        try {
          await stripe.customers.del(userData.stripe_customer_id);
          console.log(
            `[Clerk Routes]: Client Stripe supprimé: ${userData.stripe_customer_id}`
          );
        } catch (stripeError) {
          console.error(
            "[Clerk Routes]: Erreur suppression client Stripe:",
            stripeError
          );
        }
      }

      // Delete user folder from storage
      const { success, message } = await deleteSupabaseFileAction(
        userId,
        null,
        true
      );
      if (!success) {
        console.error(
          "[Clerk Routes]: Erreur lors de la suppression du dossier de l'utilisateur dans Storage:",
          message
        );
      } else {
        console.log(
          `[Clerk Routes]: Dossier de l'utilisateur ${userId} supprimé avec succès`
        );
      }
    }
  } catch (error) {
    console.error("[Clerk Routes]: Erreur dans handleUserDeleted:", error);
    throw error;
  }
}
