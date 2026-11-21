import "server-only";

import { lt } from "drizzle-orm";

import { db } from "@/db/client";
import { tiktok_webhook_events } from "@/db/schema";
import { deleteExpiredRows } from "@/lib/jobs/deleteExpiredRows";

import { inngest } from "../client";

export const cleanupTikTokWebhookEventsCron = inngest.createFunction(
  {
    id: "cleanup-tiktok-webhook-events",
    name: "Cleanup TikTok webhook events past retention",
    retries: 2,
    triggers: [{ cron: "0 8 * * *" }],
  },
  ({ step }) =>
    step.run("delete-old-tiktok-events", () =>
      deleteExpiredRows({
        table: "tiktok_webhook_events",
        deleteRows: ({ cutoffIso }) =>
          db
            .delete(tiktok_webhook_events)
            .where(lt(tiktok_webhook_events.processed_at, cutoffIso)),
      }),
    ),
);
