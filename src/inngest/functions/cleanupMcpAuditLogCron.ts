import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";

import { inngest } from "../client";

const RETENTION_DAYS = 90;

/**
 * Daily cleanup of mcp_audit_log rows older than 90 days.
 *
 * Runs at 04:00 UTC. Service-role DELETE bypasses the append-only
 * trigger (reject_mutation grants service_role bypass since the P4.4
 * migration). Other roles are still blocked.
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
      const { error, count } = await adminSupabase
        .from("mcp_audit_log")
        .delete({ count: "exact" })
        .lt("created_at", cutoffIso);

      if (error) {
        throw new Error(
          `[cleanupMcpAuditLogCron] DELETE failed: ${error.message}`,
        );
      }

      return { deleted: count ?? 0 };
    });

    console.log(
      `[cleanupMcpAuditLogCron] Deleted ${result.deleted} rows older than ${cutoffIso}`,
    );

    return { deleted: result.deleted, cutoff: cutoffIso };
  },
);
