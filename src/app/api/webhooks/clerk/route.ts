// app/api/webhooks/clerk/route.ts
import { supabase } from "@/actions/api/supabase";
import { WebhookEvent } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { Webhook } from "svix";

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    console.error("Le secret du webhook Clerk n'est pas défini");
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
    console.error("Erreur de vérification du webhook:", err);
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
        console.log("Événement non géré:", eventType);
        break;
    }

    return new Response("Webhook traité avec succès", { status: 200 });
  } catch (error) {
    console.error("Erreur lors du traitement du webhook:", error);
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
  object: string;
}

async function handleUserCreated(data: ClerkUserData) {
  try {
    const userId = data.id;
    const email = data.email_addresses?.[0]?.email_address;

    const nameParts =
      data.first_name && data.last_name
        ? [data.first_name, data.last_name]
        : (data.full_name ?? "").split(" ");

    const firstName = nameParts[0] || null;
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

    const { error } = await supabase.from("users").insert({
      id: userId,
      email,
      first_name: firstName,
      last_name: lastName,
    });

    if (error) {
      console.error(
        "Erreur lors de la création de l'utilisateur dans Supabase:",
        error
      );
    }
  } catch (error) {
    console.error("Erreur dans handleUserCreated:", error);
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
        "Erreur lors de la mise à jour de l'utilisateur dans Supabase:",
        error
      );
    }
  } catch (error) {
    console.error("Erreur dans handleUserUpdated:", error);
    throw error;
  }
}

async function handleUserDeleted(data: { id: string }) {
  try {
    const userId = data.id;

    const { error } = await supabase.from("users").delete().eq("id", userId);
    if (error) {
      console.error(
        "Erreur lors de la suppression de l'utilisateur dans Supabase:",
        error
      );
    }
  } catch (error) {
    console.error("Erreur dans handleUserDeleted:", error);
    throw error;
  }
}
