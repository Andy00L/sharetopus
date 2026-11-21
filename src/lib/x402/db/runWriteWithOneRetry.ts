import "server-only";

import { runQuery, type QueryResult } from "@/db/client";

export async function runWriteWithOneRetry<Data>(
  buildWrite: () => PromiseLike<Data>,
): Promise<QueryResult<Data>> {
  const firstAttempt = await runQuery(buildWrite());
  if (!firstAttempt.error) return firstAttempt;
  return runQuery(buildWrite());
}
