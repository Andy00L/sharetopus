import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { WebhooksClient } from "./WebhooksClient";

export const metadata: Metadata = {
  title: "Webhooks - Settings",
  description: "Manage webhook subscriptions",
};

/**
 * Server component for /settings/webhooks.
 * Verifies auth, then renders the client-side management UI.
 */
export default async function WebhooksSettingsPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/");
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Webhooks</h1>
        <p className="text-muted-foreground mt-1">
          Receive real-time notifications when events happen in your account.
        </p>
      </div>
      <WebhooksClient />
    </div>
  );
}
