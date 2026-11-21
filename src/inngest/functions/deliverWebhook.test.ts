import { beforeEach, describe, expect, mock, test } from "bun:test";

type DeliveryOutcome = {
  statusCode: number | null;
  responseBody: string | null;
  errorMessage: string | null;
};

type QueryCall = [method: string, args: unknown[]];
type RecordedQuery = { operation: string; calls: QueryCall[] };

const deliveryState: {
  outcomes: DeliveryOutcome[];
  postCount: number;
  failingInsertsLeft: number;
  failingInsertCode: string | null;
  insertAttempts: number;
  insertedAttemptNumbers: unknown[];
  updates: unknown[];
} = {
  outcomes: [],
  postCount: 0,
  failingInsertsLeft: 0,
  failingInsertCode: null,
  insertAttempts: 0,
  insertedAttemptNumbers: [],
  updates: [],
};

function buildRecordedQuery(operation: string): object {
  const recordedQuery: RecordedQuery = { operation, calls: [] };
  const queryProxy: object = new Proxy(recordedQuery, {
    get: (target, property) => {
      if (property === "operation" || property === "calls") return Reflect.get(target, property);
      return (...args: unknown[]) => {
        target.calls.push([String(property), args]);
        return queryProxy;
      };
    },
  });
  return queryProxy;
}

function readRecordedQuery(query: unknown): RecordedQuery {
  const operation: unknown = Reflect.get(Object(query), "operation");
  const calls: unknown = Reflect.get(Object(query), "calls");
  if (typeof operation !== "string" || !Array.isArray(calls)) {
    throw new Error("runQuery received an unrecorded query");
  }
  return { operation, calls };
}

function readFirstArgument(recordedQuery: RecordedQuery, method: string): unknown {
  const matchingCall = recordedQuery.calls.find((queryCall) => queryCall[0] === method);
  return matchingCall?.[1][0];
}

mock.module("server-only", () => ({}));

mock.module("@/inngest/client", () => ({
  inngest: {
    createFunction: (config: unknown, handler: (input: unknown) => Promise<unknown>) => ({
      config,
      handler,
    }),
  },
}));

mock.module("@/db/client", () => ({
  db: {
    select: () => buildRecordedQuery("select"),
    insert: () => buildRecordedQuery("insert"),
    update: () => buildRecordedQuery("update"),
  },
  runQuery: async (query: unknown) => {
    const recordedQuery = readRecordedQuery(query);
    if (recordedQuery.operation === "select") {
      return { data: [{ url: "https://hooks.example.com/in", secret: "whsec" }], error: null };
    }
    if (recordedQuery.operation === "insert") {
      deliveryState.insertAttempts += 1;
      if (deliveryState.failingInsertsLeft > 0) {
        deliveryState.failingInsertsLeft -= 1;
        return {
          data: null,
          error: { message: "insert failed", code: deliveryState.failingInsertCode },
        };
      }
      const insertedRow: unknown = readFirstArgument(recordedQuery, "values");
      deliveryState.insertedAttemptNumbers.push(Reflect.get(Object(insertedRow), "attempt"));
      return { data: [], error: null };
    }
    deliveryState.updates.push(readFirstArgument(recordedQuery, "set"));
    return { data: [], error: null };
  },
}));

mock.module("@/lib/api/rest/webhooks/deliverSignedWebhook", () => ({
  deliverSignedWebhook: async (): Promise<DeliveryOutcome> => {
    deliveryState.postCount += 1;
    return (
      deliveryState.outcomes.shift() ?? { statusCode: 200, responseBody: "", errorMessage: null }
    );
  },
}));

const { deliverWebhook } = await import("./deliverWebhook");
const { webhookDispatchEvent } = await import("../events/webhookDispatch");

function readHandler(candidate: unknown): (input: unknown) => Promise<unknown> {
  if (typeof candidate !== "object" || candidate === null || !("handler" in candidate)) {
    throw new Error("createFunction mock not applied");
  }
  const handler: unknown = candidate.handler;
  if (typeof handler !== "function") throw new Error("captured handler is not a function");
  return (input: unknown) => Promise.resolve(handler(input));
}

const STEP_RETRY_LIMIT = 3;
const completedSteps = new Map<string, unknown>();
const sleeps: string[] = [];

const step = {
  run: async (stepId: string, stepBody: () => Promise<unknown>) => {
    if (completedSteps.has(stepId)) return completedSteps.get(stepId);
    for (let stepAttempt = 0; ; stepAttempt++) {
      try {
        const stepResult = await stepBody();
        completedSteps.set(stepId, stepResult);
        return stepResult;
      } catch (stepError) {
        if (stepAttempt >= STEP_RETRY_LIMIT) throw stepError;
      }
    }
  },
  sleep: async (_stepId: string, duration: string) => {
    sleeps.push(duration);
  },
};

const EVENT_DATA = {
  subscription_id: "subscription-1",
  event_type: "post.failed",
  event_id: "event-1",
  payload: { post_id: "post-1" },
};

function runDelivery() {
  return readHandler(deliverWebhook)({ event: { data: EVENT_DATA }, step });
}

beforeEach(() => {
  deliveryState.outcomes = [];
  deliveryState.postCount = 0;
  deliveryState.failingInsertsLeft = 0;
  deliveryState.failingInsertCode = null;
  deliveryState.insertAttempts = 0;
  deliveryState.insertedAttemptNumbers = [];
  deliveryState.updates = [];
  completedSteps.clear();
  sleeps.length = 0;
});

describe("deliverWebhook", () => {
  test("a failed delivery-log insert is retried on its own and the POST is not sent again", async () => {
    deliveryState.failingInsertsLeft = 1;
    expect(await runDelivery()).toEqual({ delivered: true, status_code: 200, attempts: 1 });
    expect(deliveryState.postCount).toBe(1);
    expect(deliveryState.insertAttempts).toBe(2);
    expect(deliveryState.insertedAttemptNumbers).toEqual([1]);
  });

  test("a subscription deleted after the POST skips its log row instead of failing the run", async () => {
    deliveryState.failingInsertsLeft = 1;
    deliveryState.failingInsertCode = "23503";
    expect(await runDelivery()).toEqual({ delivered: true, status_code: 200, attempts: 1 });
    expect(deliveryState.postCount).toBe(1);
    expect(deliveryState.insertAttempts).toBe(1);
    expect(deliveryState.insertedAttemptNumbers).toEqual([]);
  });

  test("a 503 gets a new POST after a backoff, each attempt logged with its number", async () => {
    deliveryState.outcomes = [
      { statusCode: 503, responseBody: "busy", errorMessage: null },
      { statusCode: 200, responseBody: "", errorMessage: null },
    ];
    expect(await runDelivery()).toEqual({ delivered: true, status_code: 200, attempts: 2 });
    expect(deliveryState.postCount).toBe(2);
    expect(sleeps).toEqual(["30s"]);
    expect(deliveryState.insertedAttemptNumbers).toEqual([1, 2]);
    expect(deliveryState.updates).toHaveLength(1);
  });

  test("the last retryable failure counts one failure and fails the run", async () => {
    deliveryState.outcomes = Array.from({ length: 4 }, () => ({
      statusCode: null,
      responseBody: null,
      errorMessage: "fetch failed (ECONNREFUSED)",
    }));
    await expect(runDelivery()).rejects.toThrow("Delivery failed after 4 attempts");
    expect(deliveryState.postCount).toBe(4);
    expect(sleeps).toEqual(["30s", "2m", "10m"]);
    expect(deliveryState.insertedAttemptNumbers).toEqual([1, 2, 3, 4]);
    expect(deliveryState.updates).toHaveLength(1);
  });

  test("the shared event schema rejects data without a subscription_id", async () => {
    const validation = await webhookDispatchEvent.schema["~standard"].validate({
      event_type: "post.failed",
      event_id: "event-1",
      payload: {},
    });
    expect("issues" in validation && validation.issues !== undefined).toBe(true);
  });
});
