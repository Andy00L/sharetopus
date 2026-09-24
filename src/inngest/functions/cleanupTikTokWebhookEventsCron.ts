import "server-only";

import { lt } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { tiktok_webhook_events } from "@/db/schema";

import { inngest } from "../client";

/**
 * Days a dispatched TikTok event stays logged. TikTok redelivers an event for
 * 72 hours at most, so 90 days, the retention of stripe_webhook_events
 * (cleanupStripeWebhookEvents), is far past any redelivery.
 */
const RETENTION_DAYS = 90;

/**
 * Daily cleanup of tiktok_webhook_events rows older than 90 days. Runs at
 * 08:00 UTC, after the other retention crons. The table is append-only by
 * convention and has no reject_mutation trigger, so a plain DELETE goes
 * through.
 */
export const cleanupTikTokWebhookEventsCron = inngest.createFunction(
  {
    id: "cleanup-tiktok-webhook-events",
    name: "Cleanup TikTok webhook events older than 90 days",
    retries: 0,
    triggers: [{ cron: "0 8 * * *" }],
  },
  async ({ step }) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const cutoffIso = cutoff.toISOString();

    const result = await step.run("delete-old-tiktok-events", async () => {
      const { data: deleteResult, error } = await runQuery(
        db
          .delete(tiktok_webhook_events)
          .where(lt(tiktok_webhook_events.processed_at, cutoffIso)),
      );

      if (error) {
        // Thrown so Inngest records the step as failed.
        throw new Error(
          `[cleanupTikTokWebhookEventsCron] DELETE failed: ${error.message}`,
        );
      }

      return { deleted: deleteResult.count };
    });

    console.log(
      `[cleanupTikTokWebhookEventsCron] Deleted ${result.deleted} rows older than ${cutoffIso}`,
    );

    return { deleted: result.deleted, cutoff: cutoffIso };
  },
);
