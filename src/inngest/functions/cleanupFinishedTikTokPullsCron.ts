import "server-only";

import { and, isNull, lt, ne } from "drizzle-orm";

import { db } from "@/db/client";
import { pending_tiktok_pulls } from "@/db/schema";
import { deleteExpiredRows } from "@/lib/jobs/deleteExpiredRows";

import { inngest } from "../client";

export const cleanupFinishedTikTokPullsCron = inngest.createFunction(
  {
    id: "cleanup-finished-tiktok-pulls",
    name: "Cleanup finished TikTok pulls past retention",
    retries: 2,
    triggers: [{ cron: "30 8 * * *" }],
  },
  ({ step }) =>
    step.run("delete-finished-pulls", () =>
      deleteExpiredRows({
        table: "pending_tiktok_pulls",
        deleteRows: ({ cutoffIso }) =>
          db
            .delete(pending_tiktok_pulls)
            .where(
              and(
                ne(pending_tiktok_pulls.status, "pending"),
                lt(pending_tiktok_pulls.finalized_at, cutoffIso),
                isNull(pending_tiktok_pulls.scheduled_post_id),
              ),
            ),
      }),
    ),
);
