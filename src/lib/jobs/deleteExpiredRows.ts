import "server-only";

import { sql } from "drizzle-orm";

import { db, runQuery } from "@/db/client";

import { computeRetentionCutoff, type RetentionCutoff } from "./retention";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function deleteExpiredRows(input: {
  table: string;
  deleteRows: (cutoff: RetentionCutoff) => PromiseLike<{ count: number }>;
}): Promise<{ deleted: number; cutoff: string }> {
  const cutoff = computeRetentionCutoff(new Date());
  const { data: deleteResult, error } = await runQuery(input.deleteRows(cutoff));

  if (error) {
    // Inngest marks a step failed, and retries it, only when it throws:
    // https://www.inngest.com/docs/guides/error-handling
    throw new Error(`[deleteExpiredRows] ${input.table}: DELETE failed: ${error.message}`);
  }

  console.log(
    `[deleteExpiredRows] ${input.table}: deleted ${deleteResult.count} rows older than ${cutoff.cutoffIso}`,
  );
  return { deleted: deleteResult.count, cutoff: cutoff.cutoffIso };
}

export function deleteFromAppendOnlyTable<Data>(
  deleteRows: (transaction: Transaction) => PromiseLike<Data>,
): Promise<Data> {
  return db.transaction(async (transaction) => {
    // set_config's third argument true limits the setting to this transaction:
    // https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADMIN-SET
    await transaction.execute(
      sql`select set_config('app.allow_append_only_delete', 'on', true)`,
    );
    return deleteRows(transaction);
  });
}
