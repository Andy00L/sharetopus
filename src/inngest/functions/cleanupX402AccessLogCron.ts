import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";

import { inngest } from "../client";

const RETENTION_DAYS = 90;

/**
 * Daily cleanup of x402_access_log rows older than 90 days.
 *
 * Runs at 06:00 UTC. Uses the GENERATED `month` column for efficient
 * cutoff comparison. Service-role DELETE bypasses the append-only trigger.
 *
 * Mirrors cleanupMcpAuditLogCron retention policy.
 */
export const cleanupX402AccessLogCron = inngest.createFunction(
  {
    id: "cleanup-x402-access-log",
    name: "Cleanup x402_access_log rows older than 90 days",
    retries: 0,
    triggers: [{ cron: "0 6 * * *" }],
  },
  async ({ step }) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const cutoffIso = cutoff.toISOString();

    const result = await step.run("delete-old-x402-log-rows", async () => {
      const { error, count } = await adminSupabase
        .from("x402_access_log")
        .delete({ count: "exact" })
        .lt("created_at", cutoffIso);

      if (error) {
        throw new Error(
          `[cleanupX402AccessLogCron] DELETE failed: ${error.message}`,
        );
      }

      return { deleted: count ?? 0 };
    });

    console.log(
      `[cleanupX402AccessLogCron] Deleted ${result.deleted} rows older than ${cutoffIso}`,
    );

    return { deleted: result.deleted, cutoff: cutoffIso };
  },
);
