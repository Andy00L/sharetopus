import "server-only";

import { lt } from "drizzle-orm";

import { db } from "@/db/client";
import { rest_audit_log } from "@/db/schema";
import { deleteExpiredRows } from "@/lib/jobs/deleteExpiredRows";

import { inngest } from "../client";

export const cleanupRestAuditLogCron = inngest.createFunction(
  {
    id: "cleanup-rest-audit-log",
    name: "Cleanup rest_audit_log rows past retention",
    retries: 2,
    triggers: [{ cron: "0 7 * * *" }],
  },
  ({ step }) =>
    step.run("delete-old-rest-audit-rows", () =>
      deleteExpiredRows({
        table: "rest_audit_log",
        deleteRows: ({ cutoffIso }) =>
          db.delete(rest_audit_log).where(lt(rest_audit_log.created_at, cutoffIso)),
      }),
    ),
);
