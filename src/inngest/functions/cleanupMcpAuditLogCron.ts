import "server-only";

import { and, lt, lte } from "drizzle-orm";

import { mcp_audit_log } from "@/db/schema";
import {
  deleteExpiredRows,
  deleteFromAppendOnlyTable,
} from "@/lib/jobs/deleteExpiredRows";

import { inngest } from "../client";

export const cleanupMcpAuditLogCron = inngest.createFunction(
  {
    id: "cleanup-mcp-audit-log",
    name: "Cleanup mcp_audit_log rows past retention",
    retries: 2,
    triggers: [{ cron: "0 4 * * *" }],
  },
  ({ step }) =>
    step.run("delete-old-audit-rows", () =>
      deleteExpiredRows({
        table: "mcp_audit_log",
        deleteRows: ({ cutoffIso, cutoffMonth }) =>
          deleteFromAppendOnlyTable((transaction) =>
            transaction
              .delete(mcp_audit_log)
              .where(
                and(
                  lte(mcp_audit_log.month, cutoffMonth),
                  lt(mcp_audit_log.created_at, cutoffIso),
                ),
              ),
          ),
      }),
    ),
);
