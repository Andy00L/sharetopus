import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { NextRequest } from "next/server";

type StoredLock = {
  event_id: string;
  batch_id: string;
  principal_id: string;
  idempotency_key: string | null;
};

const PRINCIPAL_ID = "principal-1";
const SOCIAL_ACCOUNT_ID = "5b1f0c4e-3d2a-4f6b-8c9d-0e1f2a3b4c5d";
const REQUEST_ID = "req_test";
const INSERT_PARAMS_PER_ROW = 8;

const lockStore = new Map<string, StoredLock>();
const sentEventIds: string[] = [];

function readStatement(query: unknown): { sql: string; params: unknown[] } {
  if (typeof query !== "object" || query === null || !("toSQL" in query)) {
    throw new Error("runQuery fake expects a drizzle query");
  }
  const toSql = query.toSQL;
  if (typeof toSql !== "function") throw new Error("runQuery fake expects toSQL()");
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

function insertLocks(params: unknown[]): { event_id: string }[] {
  const insertedRows: { event_id: string }[] = [];
  for (let rowStart = 0; rowStart < params.length; rowStart += INSERT_PARAMS_PER_ROW) {
    const rowParams = params.slice(rowStart, rowStart + INSERT_PARAMS_PER_ROW);
    const storedLock: StoredLock = {
      event_id: String(rowParams[0]),
      batch_id: String(rowParams[1]),
      principal_id: String(rowParams[2]),
      idempotency_key: toNullableString(rowParams[7]),
    };
    const hasKeyConflict = [...lockStore.values()].some(
      (existingLock) =>
        storedLock.idempotency_key !== null &&
        existingLock.principal_id === storedLock.principal_id &&
        existingLock.idempotency_key === storedLock.idempotency_key,
    );
    if (lockStore.has(storedLock.event_id) || hasKeyConflict) continue;
    lockStore.set(storedLock.event_id, storedLock);
    insertedRows.push({ event_id: storedLock.event_id });
  }
  return insertedRows;
}

function selectLocksByKey(params: unknown[]): StoredLock[] {
  const [principalId, idempotencyKey] = params;
  return [...lockStore.values()].filter(
    (storedLock) =>
      storedLock.principal_id === principalId && storedLock.idempotency_key === idempotencyKey,
  );
}

mock.module("server-only", () => ({}));
mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async (query: unknown) => {
    const { sql, params } = readStatement(query);
    if (sql.startsWith('select "id", "platform" from "social_accounts"')) {
      return { data: [{ id: SOCIAL_ACCOUNT_ID, platform: "linkedin" }], error: null };
    }
    if (sql.startsWith('insert into "pending_direct_posts"')) {
      return { data: insertLocks(params), error: null };
    }
    if (sql.startsWith("select") && sql.includes('from "pending_direct_posts"')) {
      return { data: selectLocksByKey(params), error: null };
    }
    throw new Error(`Unexpected statement: ${sql}`);
  },
}));
mock.module("@/inngest/client", () => ({
  inngest: {
    send: async (payloads: { id: string }[]) => {
      sentEventIds.push(...payloads.map((payload) => payload.id));
      return { ids: payloads.map((payload) => payload.id) };
    },
  },
}));
mock.module("@/actions/server/rateLimit/checkRateLimit", () => ({
  checkRateLimit: async () => ({ success: true }),
}));
mock.module("@/actions/server/data/getServerSignedViewUrl", () => ({
  getServerSignedViewUrl: async () => ({ success: true, url: "https://storage.test/unused" }),
  getServerSignedViewUrls: async () => ({ success: true, urlByPath: new Map() }),
}));
mock.module("@/lib/api/rest/middleware/withRestEndpoint", () => ({
  withRestEndpoint: (config: {
    handler: (
      ctx: { principal: { principalId: string }; requestId: string },
      request: NextRequest,
    ) => Promise<Response | { response: Response }>;
  }) => async (request: NextRequest) => {
    const handlerResult = await config.handler(
      { principal: { principalId: PRINCIPAL_ID }, requestId: REQUEST_ID },
      request,
    );
    return "response" in handlerResult ? handlerResult.response : handlerResult;
  },
}));
mock.module("@/actions/server/scheduleActions/schedule/schedulePostBatch", () => ({
  schedulePostBatch: async () => ({ success: false, failure: "internal", message: "unused" }),
}));

const { POST } = await import("./route");

function createPostNow(): Promise<Response> {
  return POST(
    new NextRequest("https://sharetopus.test/api/v1/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        social_account_id: SOCIAL_ACCOUNT_ID,
        platform: "linkedin",
        post_type: "text",
        description: "Launch day.",
        idempotency_key: "key-1",
      }),
    }),
  );
}

function readOnlyLock(): StoredLock {
  const [storedLock, ...otherLocks] = lockStore.values();
  if (!storedLock || otherLocks.length > 0) {
    throw new Error(`[readOnlyLock] expected one dispatch row, found ${lockStore.size}`);
  }
  return storedLock;
}

beforeEach(() => {
  lockStore.clear();
  sentEventIds.length = 0;
});

describe("POST /api/v1/posts without scheduled_at", () => {
  test("answers 202 with the dispatch it started", async () => {
    const response = await createPostNow();

    const storedLock = readOnlyLock();
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      dispatch_id: storedLock.event_id,
      batch_id: storedLock.batch_id,
      status: "processing",
      platform: "linkedin",
      social_account_id: SOCIAL_ACCOUNT_ID,
    });
    expect(sentEventIds).toEqual([`post.now-${storedLock.event_id}`]);
  });

  test("a retry with the same idempotency_key answers 202 with the first call's dispatch id and batch id, and sends nothing", async () => {
    const firstResponse = await createPostNow();
    const firstDispatch: unknown = await firstResponse.json();

    const retryResponse = await createPostNow();

    const storedLock = readOnlyLock();
    expect(retryResponse.status).toBe(202);
    expect(await retryResponse.json()).toEqual(firstDispatch);
    expect(firstDispatch).toMatchObject({
      dispatch_id: storedLock.event_id,
      batch_id: storedLock.batch_id,
    });
    expect(sentEventIds).toEqual([`post.now-${storedLock.event_id}`]);
  });
});
