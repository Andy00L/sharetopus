import "server-only";

import { and, asc, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import type { Platform } from "@/db/schema";
import {
  buildTokenRefreshEvents,
  TOKEN_REFRESH_HORIZON_MS,
} from "@/inngest/events/socialAccountTokenRefresh";

import { inngest } from "../client";

const ENSURE_VALID_TOKEN_PLATFORMS = [
  "tiktok",
  "pinterest",
  "linkedin",
  "youtube",
  "x",
  "instagram",
  "facebook",
] as const satisfies readonly Platform[];

const MAX_ACCOUNTS_PER_RUN = 1000;

export const refreshExpiringTokensCron = inngest.createFunction(
  {
    id: "refresh-expiring-tokens",
    name: "Request a token refresh for accounts expiring within 7 days",
    retries: 2,
    triggers: [{ cron: "0 1 * * *" }],
  },
  async ({ step }) => {
    const socialAccountIds = await step.run("find-expiring-accounts", async () => {
      const horizonIso = new Date(Date.now() + TOKEN_REFRESH_HORIZON_MS).toISOString();
      const { data: accountRows, error } = await runQuery(
        db
          .select({ id: social_accounts.id })
          .from(social_accounts)
          .where(
            and(
              isNull(social_accounts.deleted_at),
              isNotNull(social_accounts.token_expires_at),
              eq(social_accounts.is_available, true),
              inArray(social_accounts.platform, ENSURE_VALID_TOKEN_PLATFORMS),
              lt(social_accounts.token_expires_at, horizonIso),
            ),
          )
          .orderBy(asc(social_accounts.token_expires_at))
          .limit(MAX_ACCOUNTS_PER_RUN),
      );
      if (error) {
        // Inngest marks a step failed, and retries it, only when it throws:
        // https://www.inngest.com/docs/guides/error-handling
        throw new Error(`[refreshExpiringTokensCron] Account query failed: ${error.message}`);
      }
      return accountRows.map((accountRow) => accountRow.id);
    });

    if (socialAccountIds.length > 0) {
      await step.sendEvent(
        "request-refreshes",
        buildTokenRefreshEvents({ socialAccountIds, now: new Date() }),
      );
    }

    return { requested: socialAccountIds.length };
  },
);
