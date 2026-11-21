import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

import type { PostNowEventData } from "@/inngest/events/postNow";

type StoredLock = {
  event_id: string;
  principal_id: string;
  idempotency_key: string | null;
  status: "processing" | "completed" | "failed";
};

type StatementKind = "insert" | "select" | "delete";

const INSERT_PARAMS_PER_ROW = 8;
const PRINCIPAL_ID = "principal-1";

const lockStore = new Map<string, StoredLock>();
const failingStatements = new Set<StatementKind>();
const sentEventIds: string[][] = [];
const sendBehavior = { shouldFail: false };

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

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function hasKeyConflict(principalId: string, idempotencyKey: string | null): boolean {
  if (idempotencyKey === null) return false;
  return [...lockStore.values()].some(
    (storedLock) =>
      storedLock.principal_id === principalId && storedLock.idempotency_key === idempotencyKey,
  );
}

function insertLocks(params: unknown[]): { event_id: string }[] {
  const insertedRows: { event_id: string }[] = [];
  for (let rowStart = 0; rowStart < params.length; rowStart += INSERT_PARAMS_PER_ROW) {
    const rowParams = params.slice(rowStart, rowStart + INSERT_PARAMS_PER_ROW);
    const eventId = String(rowParams[0]);
    const principalId = String(rowParams[2]);
    const idempotencyKey = toNullableString(rowParams[7]);
    if (lockStore.has(eventId) || hasKeyConflict(principalId, idempotencyKey)) continue;
    lockStore.set(eventId, {
      event_id: eventId,
      principal_id: principalId,
      idempotency_key: idempotencyKey,
      status: "processing",
    });
    insertedRows.push({ event_id: eventId });
  }
  return insertedRows;
}

function selectLocksByKey(params: unknown[]): StoredLock[] {
  const matchingLocks: StoredLock[] = [];
  for (let pairStart = 0; pairStart < params.length; pairStart += 2) {
    const principalId = String(params[pairStart]);
    const idempotencyKey = toNullableString(params[pairStart + 1]);
    for (const storedLock of lockStore.values()) {
      if (storedLock.principal_id === principalId && storedLock.idempotency_key === idempotencyKey) {
        matchingLocks.push(storedLock);
      }
    }
  }
  return matchingLocks;
}

function deleteProcessingLocks(params: unknown[]): { event_id: string }[] {
  const eventIds = params.slice(0, -1).map(String);
  return eventIds.flatMap((eventId) => {
    const storedLock = lockStore.get(eventId);
    if (!storedLock || storedLock.status !== "processing") return [];
    lockStore.delete(eventId);
    return [{ event_id: eventId }];
  });
}

function classifyStatement(sql: string): StatementKind {
  if (sql.startsWith("insert")) return "insert";
  if (sql.startsWith("select")) return "select";
  if (sql.startsWith("delete")) return "delete";
  throw new Error(`Unexpected statement: ${sql}`);
}

mock.module("server-only", () => ({}));

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async (query: unknown) => {
    const { sql, params } = readSqlStatement(query);
    const statementKind = classifyStatement(sql);
    if (failingStatements.has(statementKind)) {
      return { data: null, error: { message: `injected ${statementKind} failure`, code: null } };
    }
    if (statementKind === "insert") return { data: insertLocks(params), error: null };
    if (statementKind === "select") return { data: selectLocksByKey(params), error: null };
    return { data: deleteProcessingLocks(params), error: null };
  },
}));

mock.module("@/inngest/client", () => ({
  inngest: {
    send: async (payloads: { id: string; validate: () => Promise<void> }[]) => {
      if (sendBehavior.shouldFail) throw new Error("inngest unreachable");
      for (const payload of payloads) await payload.validate();
      sentEventIds.push(payloads.map((payload) => payload.id));
      return { ids: payloads.map((payload) => payload.id) };
    },
  },
}));

const { dispatchPostNowEvents } = await import("./dispatchPostNowEvents");

function buildPostNowData(dispatchId: string, idempotencyKey: string): PostNowEventData {
  return {
    dispatch_id: dispatchId,
    batch_id: "batch-1",
    principal_id: PRINCIPAL_ID,
    social_account_id: "account-1",
    platform: "x",
    post_type: "text",
    account_content: { title: "", description: "hello", link: "" },
    platform_options: {},
    board: null,
    cover_timestamp: null,
    media_path: "",
    created_via: "mcp",
    idempotency_key: idempotencyKey,
    request_id: null,
    post_options: null,
  };
}

beforeEach(() => {
  lockStore.clear();
  failingStatements.clear();
  sentEventIds.length = 0;
  sendBehavior.shouldFail = false;
});

describe("dispatchPostNowEvents", () => {
  test("a failed send removes its locks, so a keyed retry sends the event", async () => {
    sendBehavior.shouldFail = true;
    const failedDispatch = await dispatchPostNowEvents([buildPostNowData("dispatch-a", "key-1")]);
    expect(failedDispatch).toMatchObject({ success: false, phase: "inngest_send" });
    expect([...lockStore.keys()]).toEqual([]);

    sendBehavior.shouldFail = false;
    const retriedDispatch = await dispatchPostNowEvents([buildPostNowData("dispatch-b", "key-1")]);
    expect(retriedDispatch).toEqual({
      success: true,
      eventIds: ["dispatch-b"],
      freshCount: 1,
      refused: [],
    });
    expect(sentEventIds).toEqual([["post.now-dispatch-b"]]);
  });

  test("a repeated key reports the existing lock's id and sends nothing", async () => {
    await dispatchPostNowEvents([buildPostNowData("dispatch-a", "key-1")]);
    const repeatedDispatch = await dispatchPostNowEvents([
      buildPostNowData("dispatch-b", "key-1"),
      buildPostNowData("dispatch-c", "key-2"),
    ]);
    expect(repeatedDispatch).toEqual({
      success: true,
      eventIds: ["dispatch-a", "dispatch-c"],
      freshCount: 1,
      refused: [],
    });
    expect(sentEventIds).toEqual([["post.now-dispatch-a"], ["post.now-dispatch-c"]]);
  });

  test("a failed lookup of existing locks is an error and frees the locks this call wrote", async () => {
    await dispatchPostNowEvents([buildPostNowData("dispatch-a", "key-1")]);
    failingStatements.add("select");
    const failedDispatch = await dispatchPostNowEvents([
      buildPostNowData("dispatch-b", "key-1"),
      buildPostNowData("dispatch-c", "key-2"),
    ]);
    expect(failedDispatch).toMatchObject({ success: false, phase: "lock_insert" });
    expect([...lockStore.keys()]).toEqual(["dispatch-a"]);
    expect(sentEventIds).toEqual([["post.now-dispatch-a"]]);
  });

  test("an event the shared schema rejects is refused by name, takes no lock, and the rest are sent", async () => {
    const malformedPost = {
      ...buildPostNowData("dispatch-a", "key-1"),
      social_account_id: "account-bad",
      dispatch_id: "",
    };
    const dispatch = await dispatchPostNowEvents([
      malformedPost,
      buildPostNowData("dispatch-b", "key-2"),
    ]);
    expect(dispatch).toEqual({
      success: true,
      eventIds: ["dispatch-b"],
      freshCount: 1,
      refused: [
        {
          dispatchId: "",
          socialAccountId: "account-bad",
          message: expect.stringContaining("dispatch_id"),
        },
      ],
    });
    expect(sentEventIds).toEqual([["post.now-dispatch-b"]]);
    expect([...lockStore.keys()]).toEqual(["dispatch-b"]);
  });
});
