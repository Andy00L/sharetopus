import { lt } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { stripe_webhook_events } from "@/db/schema";
import { inngest } from "@/inngest/client";

export const cleanupStripeWebhookEvents = inngest.createFunction(
  {
    id: "cleanup-stripe-webhook-events",
    name: "Cleanup Stripe webhook events (90d retention)",
    retries: 0,
    triggers: [{ cron: "0 3 * * *" }],
  },
  async ({ step }) => {
    return await step.run("delete-old-events", async () => {
      const cutoff = new Date(
        Date.now() - 90 * 24 * 60 * 60 * 1000,
      ).toISOString();

      const { data: deleteResult, error } = await runQuery(
        db
          .delete(stripe_webhook_events)
          .where(lt(stripe_webhook_events.processed_at, cutoff)),
      );

      if (error) {
        console.error(
          "[cleanupStripeWebhookEvents] Delete failed:",
          error.message,
        );
        // Thrown so Inngest records the step as failed.
        throw new Error(`Delete failed: ${error.message}`);
      }

      console.log(
        `[cleanupStripeWebhookEvents] Deleted ${deleteResult.count} events older than ${cutoff}`,
      );
      return { deleted: deleteResult.count, cutoff };
    });
  },
);
