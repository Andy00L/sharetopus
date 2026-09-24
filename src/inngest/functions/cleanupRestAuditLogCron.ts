import "server-only";

import { lt } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { rest_audit_log } from "@/db/schema";

import { inngest } from "../client";

const RETENTION_DAYS = 90;

/**
 * Daily cleanup of rest_audit_log rows older than 90 days, the retention of
 * the other request logs (cleanupMcpAuditLogCron, cleanupX402AccessLogCron).
 *
 * Runs at 07:00 UTC. rest_audit_log is append-only by convention and has
 * no reject_mutation trigger, so a plain DELETE goes through.
 */
export const cleanupRestAuditLogCron = inngest.createFunction(
  {
    id: "cleanup-rest-audit-log",
    name: "Cleanup rest_audit_log rows older than 90 days",
    retries: 0,
    triggers: [{ cron: "0 7 * * *" }],
  },
  async ({ step }) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const cutoffIso = cutoff.toISOString();

    const result = await step.run("delete-old-rest-audit-rows", async () => {
      const { data: deleteResult, error } = await runQuery(
        db
          .delete(rest_audit_log)
          .where(lt(rest_audit_log.created_at, cutoffIso)),
      );

      if (error) {
        // Thrown so Inngest records the step as failed.
        throw new Error(
          `[cleanupRestAuditLogCron] DELETE failed: ${error.message}`,
        );
      }

      return { deleted: deleteResult.count };
    });

    console.log(
      `[cleanupRestAuditLogCron] Deleted ${result.deleted} rows older than ${cutoffIso}`,
    );

    return { deleted: result.deleted, cutoff: cutoffIso };
  },
);
