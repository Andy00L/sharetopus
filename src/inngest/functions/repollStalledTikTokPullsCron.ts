import "server-only";

import { and, asc, eq, isNull, lt, or } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { pending_tiktok_pulls } from "@/db/schema";
import { buildTikTokRepollEvents } from "@/inngest/events/tikTokPublishPoll";

import { inngest } from "../client";

const STALLED_AFTER_MS = 10 * 60 * 1000;

const MAX_PULLS_PER_RUN = 500;

export const repollStalledTikTokPullsCron = inngest.createFunction(
  {
    id: "repoll-stalled-tiktok-pulls",
    name: "Re-send the status poll for pending TikTok pulls nobody polls",
    retries: 2,
    triggers: [{ cron: "40 * * * *" }],
  },
  async ({ step }) => {
    const stalledPulls = await step.run("find-stalled-pulls", async () => {
      const stalledBeforeIso = new Date(Date.now() - STALLED_AFTER_MS).toISOString();
      const { data: pullRows, error } = await runQuery(
        db
          .select({
            publish_id: pending_tiktok_pulls.publish_id,
            social_account_id: pending_tiktok_pulls.social_account_id,
          })
          .from(pending_tiktok_pulls)
          .where(
            and(
              eq(pending_tiktok_pulls.status, "pending"),
              lt(pending_tiktok_pulls.created_at, stalledBeforeIso),
              or(
                isNull(pending_tiktok_pulls.last_polled_at),
                lt(pending_tiktok_pulls.last_polled_at, stalledBeforeIso),
              ),
            ),
          )
          .orderBy(asc(pending_tiktok_pulls.created_at))
          .limit(MAX_PULLS_PER_RUN),
      );
      if (error) {
        // Inngest marks a step failed, and retries it, only when it throws:
        // https://www.inngest.com/docs/guides/error-handling
        throw new Error(`[repollStalledTikTokPullsCron] Pull query failed: ${error.message}`);
      }
      return pullRows;
    });

    if (stalledPulls.length > 0) {
      await step.sendEvent(
        "resend-polls",
        buildTikTokRepollEvents({ pulls: stalledPulls, now: new Date() }),
      );
    }

    return { resent: stalledPulls.length };
  },
);
