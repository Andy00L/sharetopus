import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

type StoredDispatch = {
  event_id: string;
  batch_id: string;
  social_account_id: string;
  platform: string;
  status: string;
  failure_reason: string | null;
  created_at: string;
  publish_started_at: string | null;
};

const DISPATCH_ID = "dispatch-1";
const CLAIM_TIME = "2026-11-21T10:00:00.000Z";
const TABLE_PREFIX = '"pending_direct_posts".';
const CONDITION_PATTERN = /^"pending_direct_posts"\."(\w+)" (?:= \$(\d+)|(is null))$/;
const ASSIGNMENT_PATTERN = /"(\w+)" = \$(\d+)/g;

const dispatchStore = new Map<string, StoredDispatch>();
const databaseState = { isFailing: false };

function readSqlStatement(query: unknown): { sql: string; params: unknown[] } {
  if (typeof query !== "object" || query === null || !("toSQL" in query)) {
    throw new Error("runQuery mock expects a drizzle query");
  }
  const toSql = query.toSQL;
  if (typeof toSql !== "function") throw new Error("runQuery mock expects toSQL()");
  const statement: unknown = toSql.call(query);
  if (
    typeof statement !== "object" ||
    statement === null ||
    !("sql" in statement) ||
    !("params" in statement) ||
    typeof statement.sql !== "string" ||
    !Array.isArray(statement.params)
  ) {
    throw new Error("toSQL() returned an unexpected shape");
  }
  return { sql: statement.sql, params: statement.params };
}

function readColumn(storedDispatch: StoredDispatch, column: string): string | null {
  switch (column) {
    case "event_id":
    case "status":
    case "publish_started_at":
      return storedDispatch[column];
    default:
      throw new Error(`Unexpected column in a condition: ${column}`);
  }
}

function matchesWhere(sql: string, params: unknown[], storedDispatch: StoredDispatch): boolean {
  const whereSql = (sql.split(" where ")[1] ?? "").split(/ returning | limit /)[0];
  const conditions = whereSql.replace(/^\(|\)$/g, "").split(" and ");
  return conditions.every((condition) => {
    if (!condition.startsWith(TABLE_PREFIX)) throw new Error(`Unexpected condition: ${condition}`);
    const conditionMatch = CONDITION_PATTERN.exec(condition);
    if (!conditionMatch) throw new Error(`Unexpected condition: ${condition}`);
    const [, column, paramIndex, isNullTest] = conditionMatch;
    const storedValue = readColumn(storedDispatch, column);
    if (isNullTest) return storedValue === null;
    return storedValue === params[Number(paramIndex) - 1];
  });
}

function runStatement(sql: string, params: unknown[]): StoredDispatch[] | { event_id: string }[] {
  const matchingDispatches = [...dispatchStore.values()].filter((storedDispatch) =>
    matchesWhere(sql, params, storedDispatch),
  );
  if (sql.startsWith("select")) return matchingDispatches;
  if (!sql.startsWith('update "pending_direct_posts" set ')) throw new Error(`Unexpected statement: ${sql}`);
  const assignments = [...sql.split(" where ")[0].matchAll(ASSIGNMENT_PATTERN)];
  return matchingDispatches.map((storedDispatch) => {
    const updatedDispatch = { ...storedDispatch };
    for (const [, column, paramIndex] of assignments) {
      const assignedValue = params[Number(paramIndex) - 1];
      if (column !== "publish_started_at") throw new Error(`Unexpected assignment to ${column}`);
      updatedDispatch.publish_started_at = typeof assignedValue === "string" ? assignedValue : null;
    }
    dispatchStore.set(storedDispatch.event_id, updatedDispatch);
    return { event_id: storedDispatch.event_id };
  });
}

mock.module("server-only", () => ({}));

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async (query: unknown) => {
    if (databaseState.isFailing) return { data: null, error: { message: "connection reset", code: "08006" } };
    const { sql, params } = readSqlStatement(query);
    return { data: runStatement(sql, params), error: null };
  },
}));

const { claimDirectPublishAttempt, releaseDirectPublishAttempt } = await import(
  "./processDirectPostHelpers"
);

function storeDispatch(changes: Partial<StoredDispatch>): void {
  dispatchStore.set(DISPATCH_ID, {
    event_id: DISPATCH_ID,
    batch_id: "batch-1",
    social_account_id: "account-1",
    platform: "linkedin",
    status: "processing",
    failure_reason: null,
    created_at: "2026-11-21T09:59:59.000Z",
    publish_started_at: null,
    ...changes,
  });
}

function readStoredClaim(): string | null | undefined {
  return dispatchStore.get(DISPATCH_ID)?.publish_started_at;
}

beforeEach(() => {
  dispatchStore.clear();
  databaseState.isFailing = false;
});

describe("claimDirectPublishAttempt", () => {
  test("the first attempt claims the dispatch, and a second claim finds the attempt already started", async () => {
    storeDispatch({});
    expect(await claimDirectPublishAttempt(DISPATCH_ID)).toEqual({ success: true, kind: "claimed" });
    expect(readStoredClaim()).not.toBeNull();
    expect(await claimDirectPublishAttempt(DISPATCH_ID)).toEqual({
      success: true,
      kind: "attempt-already-started",
    });
  });

  test("a released claim lets the next attempt claim again", async () => {
    storeDispatch({ publish_started_at: CLAIM_TIME });
    expect(await releaseDirectPublishAttempt(DISPATCH_ID)).toEqual({ success: true });
    expect(readStoredClaim()).toBeNull();
    expect(await claimDirectPublishAttempt(DISPATCH_ID)).toEqual({ success: true, kind: "claimed" });
  });

  test("a dispatch that is gone, completed, or failed with no claim is never claimed", async () => {
    expect(await claimDirectPublishAttempt(DISPATCH_ID)).toEqual({ success: true, kind: "dispatch-gone" });

    storeDispatch({ status: "completed" });
    expect(await claimDirectPublishAttempt(DISPATCH_ID)).toEqual({ success: true, kind: "already-published" });
    expect(readStoredClaim()).toBeNull();

    storeDispatch({ status: "failed", failure_reason: "stale_worker_swept" });
    expect(await claimDirectPublishAttempt(DISPATCH_ID)).toEqual({ success: true, kind: "already-failed" });
    expect(readStoredClaim()).toBeNull();
  });

  test("a swept dispatch whose claim an earlier attempt still holds reports that attempt", async () => {
    storeDispatch({ status: "failed", failure_reason: "stale_worker_swept", publish_started_at: CLAIM_TIME });
    expect(await claimDirectPublishAttempt(DISPATCH_ID)).toEqual({
      success: true,
      kind: "attempt-already-started",
    });
  });

  test("a claim the database refuses comes back as an error value and claims nothing", async () => {
    storeDispatch({});
    databaseState.isFailing = true;
    const claimResult = await claimDirectPublishAttempt(DISPATCH_ID);
    expect(claimResult.success).toBe(false);
    expect(readStoredClaim()).toBeNull();
  });
});
