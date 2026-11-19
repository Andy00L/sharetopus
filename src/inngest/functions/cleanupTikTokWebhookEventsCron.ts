import "server-only";

import { lt } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { tiktok_webhook_events } from "@/db/schema";

import { inngest } from "../client";

// Must outlast TikTok's 72-hour redelivery window:
// https://developers.tiktok.com/doc/webhooks-overview
const RETENTION_DAYS = 90;

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
