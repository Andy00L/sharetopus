import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";

import { inngest } from "../client";

/**
 * Every 6 hours, purge expired and consumed siwe_nonces rows.
 *
 * SIWE nonces have a 5-minute TTL. This cron keeps a 1-day buffer after
 * expiry or consumption for debugging visibility, then removes them.
 *
 * Deletion criteria:
 *   - used_at IS NOT NULL AND used_at < now() - 1 day (consumed, old)
 *   - expires_at < now() - 1 day (expired, never used, old)
 */
export const cleanupSiweNoncesCron = inngest.createFunction(
  {
    id: "cleanup-siwe-nonces",
    name: "Cleanup siwe_nonces rows older than 1 day past expiry/use",
    retries: 0,
    triggers: [{ cron: "0 */6 * * *" }],
  },
  async ({ step }) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 1);
    const cutoffIso = cutoff.toISOString();

    const result = await step.run("delete-old-siwe-nonces", async () => {
      // Delete nonces that were used more than 1 day ago.
      const { error: usedError, count: usedCount } = await adminSupabase
        .from("siwe_nonces")
        .delete({ count: "exact" })
        .not("used_at", "is", null)
        .lt("used_at", cutoffIso);

      if (usedError) {
        throw new Error(
          `[cleanupSiweNoncesCron] DELETE used nonces failed: ${usedError.message}`,
        );
      }

      // Delete nonces that expired more than 1 day ago (never used).
      const { error: expiredError, count: expiredCount } = await adminSupabase
        .from("siwe_nonces")
        .delete({ count: "exact" })
        .lt("expires_at", cutoffIso);

      if (expiredError) {
        throw new Error(
          `[cleanupSiweNoncesCron] DELETE expired nonces failed: ${expiredError.message}`,
        );
      }

      return {
        deletedUsed: usedCount ?? 0,
        deletedExpired: expiredCount ?? 0,
      };
    });

    const total = result.deletedUsed + result.deletedExpired;
    console.log(
      `[cleanupSiweNoncesCron] Deleted ${total} nonces (${result.deletedUsed} used, ${result.deletedExpired} expired) older than ${cutoffIso}`,
    );

    return { deleted: total, cutoff: cutoffIso };
  },
);
