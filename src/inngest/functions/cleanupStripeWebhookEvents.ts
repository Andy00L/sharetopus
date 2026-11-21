import "server-only";

import { lt } from "drizzle-orm";

import { db } from "@/db/client";
import { stripe_webhook_events } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { deleteExpiredRows } from "@/lib/jobs/deleteExpiredRows";

export const cleanupStripeWebhookEvents = inngest.createFunction(
  {
    id: "cleanup-stripe-webhook-events",
    name: "Cleanup Stripe webhook events past retention",
    retries: 2,
    triggers: [{ cron: "0 3 * * *" }],
  },
  ({ step }) =>
    step.run("delete-old-events", () =>
      deleteExpiredRows({
        table: "stripe_webhook_events",
        deleteRows: ({ cutoffIso }) =>
          db
            .delete(stripe_webhook_events)
            .where(lt(stripe_webhook_events.processed_at, cutoffIso)),
      }),
    ),
);
