import { adminSupabase } from "@/actions/api/adminSupabase";
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

      const { count, error } = await adminSupabase
        .from("stripe_webhook_events")
        .delete({ count: "exact" })
        .lt("processed_at", cutoff);

      if (error) {
        console.error(
          "[cleanupStripeWebhookEvents] Delete failed:",
          error.message,
        );
        throw new Error(`Delete failed: ${error.message}`);
      }

      console.log(
        `[cleanupStripeWebhookEvents] Deleted ${count ?? 0} events older than ${cutoff}`,
      );
      return { deleted: count ?? 0, cutoff };
    });
  },
);
