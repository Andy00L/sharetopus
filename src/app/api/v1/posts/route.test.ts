import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { NextRequest } from "next/server";

type DispatchOutcome = { batchId: string; eventIds: string[]; dispatched: number };

const PRINCIPAL_ID = "principal-1";
const SOCIAL_ACCOUNT_ID = "5b1f0c4e-3d2a-4f6b-8c9d-0e1f2a3b4c5d";
const REQUEST_ID = "req_test";

let dispatchOutcome: DispatchOutcome = { batchId: "batch-1", eventIds: ["dispatch-1"], dispatched: 1 };

beforeEach(() => {
  dispatchOutcome = { batchId: "batch-1", eventIds: ["dispatch-1"], dispatched: 1 };
});

mock.module("server-only", () => ({}));
mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async () => ({ data: [], error: null }),
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
mock.module("@/actions/server/directPostActions/directPostBatch", () => ({
  directPostBatch: async () => ({
    success: true,
    message: "Dispatched.",
    batchId: dispatchOutcome.batchId,
    eventIds: dispatchOutcome.eventIds,
    details: {
      total: 1,
      dispatched: dispatchOutcome.dispatched,
      duplicates: 1 - dispatchOutcome.dispatched,
      rejected: [],
    },
  }),
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

describe("POST /api/v1/posts without scheduled_at", () => {
  test("answers 202 with the dispatch it started", async () => {
    const response = await createPostNow();

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      dispatch_id: "dispatch-1",
      batch_id: "batch-1",
      status: "processing",
      platform: "linkedin",
      social_account_id: SOCIAL_ACCOUNT_ID,
    });
  });

  test("a retry with the same idempotency_key answers 202 with the first dispatch id and no batch id", async () => {
    dispatchOutcome = { batchId: "batch-unused", eventIds: ["dispatch-first"], dispatched: 0 };

    const response = await createPostNow();

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      dispatch_id: "dispatch-first",
      batch_id: null,
      status: "processing",
      platform: "linkedin",
      social_account_id: SOCIAL_ACCOUNT_ID,
    });
  });
});
