import "server-only";

import { lt } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { mcp_audit_log } from "@/db/schema";

import { inngest } from "../client";

const RETENTION_DAYS = 90;

/**
 * Daily cleanup of mcp_audit_log rows older than 90 days.
 *
 * Runs at 04:00 UTC. The table's append-only trigger (reject_mutation)
 * refuses a DELETE unless the transaction sets
 * app.allow_append_only_delete = 'on'. Nothing sets it yet, so this job
 * fails at the DELETE and no rows are removed; switching retention on is
 * pending (docs/DATABASE.md, data lifecycle).
 *
 * Retention rationale:
 *   - 90 days covers most compliance / forensics windows
 *   - Recent debugging usually happens within 30 days
 *   - Older rows are storage waste with diminishing analytics value
 *
 * Adjust RETENTION_DAYS upward if a regulator or contract requires
 * longer retention.
 */
export const cleanupMcpAuditLogCron = inngest.createFunction(
  {
    id: "cleanup-mcp-audit-log",
    name: "Cleanup mcp_audit_log rows older than 90 days",
    retries: 0,
    triggers: [{ cron: "0 4 * * *" }],
  },
  async ({ step }) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const cutoffIso = cutoff.toISOString();

    const result = await step.run("delete-old-audit-rows", async () => {
      const { data: deleteResult, error } = await runQuery(
        db.delete(mcp_audit_log).where(lt(mcp_audit_log.created_at, cutoffIso)),
      );

      if (error) {
        // Thrown so Inngest records the step as failed.
        throw new Error(
          `[cleanupMcpAuditLogCron] DELETE failed: ${error.message}`,
        );
      }

      return { deleted: deleteResult.count };
    });

    console.log(
      `[cleanupMcpAuditLogCron] Deleted ${result.deleted} rows older than ${cutoffIso}`,
    );

    return { deleted: result.deleted, cutoff: cutoffIso };
  },
);
