import "server-only";

import { and, lt, lte } from "drizzle-orm";

import { x402_access_log } from "@/db/schema";
import {
  deleteExpiredRows,
  deleteFromAppendOnlyTable,
} from "@/lib/jobs/deleteExpiredRows";

import { inngest } from "../client";

export const cleanupX402AccessLogCron = inngest.createFunction(
  {
    id: "cleanup-x402-access-log",
    name: "Cleanup x402_access_log rows past retention",
    retries: 2,
    triggers: [{ cron: "0 6 * * *" }],
  },
  ({ step }) =>
    step.run("delete-old-x402-log-rows", () =>
      deleteExpiredRows({
        table: "x402_access_log",
        deleteRows: ({ cutoffIso, cutoffMonth }) =>
          deleteFromAppendOnlyTable((transaction) =>
            transaction
              .delete(x402_access_log)
              .where(
                and(
                  lte(x402_access_log.month, cutoffMonth),
                  lt(x402_access_log.created_at, cutoffIso),
                ),
              ),
          ),
      }),
    ),
);
