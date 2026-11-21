import { beforeEach, describe, expect, mock, test } from "bun:test";

import { createFakePostgres, type FakeRow } from "./fakePostgres";

type SentWebhooks = { principalId: string; eventType: string; payloads: Record<string, unknown>[] };

const MINUTE_MS = 60 * 1000;
const SWEPT_MESSAGE = "Publishing stopped without a result; the post may have published";
const SWEPT_UNCLAIMED_MESSAGE = "Publishing never started before the hourly sweep; the post was not published";

const fakePostgres = createFakePostgres();
const sentWebhooks: SentWebhooks[] = [];

class FunctionKilled extends Error {}

process.env.DATABASE_URL = "postgres://fake:fake@localhost:5432/fake";

mock.module("server-only", () => ({}));

mock.module("postgres", () => ({ default: () => fakePostgres.client }));

mock.module("@/inngest/client", () => ({
  inngest: {
    createFunction: (config: unknown, handler: (input: unknown) => Promise<unknown>) => ({ config, handler }),
  },
}));

mock.module("@/lib/api/rest/webhooks/dispatch", () => ({
  dispatchWebhook: async (principalId: string, eventType: string, payload: Record<string, unknown>) => {
    sentWebhooks.push({ principalId, eventType, payloads: [payload] });
  },
  dispatchWebhooks: async (principalId: string, eventType: string, payloads: Record<string, unknown>[]) => {
    sentWebhooks.push({ principalId, eventType, payloads });
  },
}));

const { sweepStuckDirectPosts } = await import("./sweepStuckDirectPosts");

type CapturedFunction = { handler: (input: unknown) => Promise<unknown> };

function readCapturedFunction(candidate: unknown): CapturedFunction {
  if (typeof candidate !== "object" || candidate === null || !("handler" in candidate)) {
    throw new Error("createFunction mock not applied");
  }
  const handler: unknown = candidate.handler;
  if (typeof handler !== "function") throw new Error("captured handler is not a function");
  return { handler: (input: unknown) => Promise.resolve(handler(input)) };
}

const sweepFunction = readCapturedFunction(sweepStuckDirectPosts);

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * MINUTE_MS).toISOString();
}

function buildDispatchRow(changes: Partial<FakeRow>): FakeRow {
  return {
    event_id: "dispatch-1",
    batch_id: "batch-1",
    principal_id: "principal-1",
    social_account_id: "account-1",
    platform: "linkedin",
    media_storage_path: "",
    status: "processing",
    failure_reason: null,
    created_at: minutesAgo(90),
    finished_at: null,
    idempotency_key: null,
    publish_started_at: null,
    ...changes,
  };
}

function readDispatch(dispatchId: string): FakeRow | undefined {
  return fakePostgres.tables.get("pending_direct_posts")?.find((row) => row.event_id === dispatchId);
}

// Inngest stores each finished step's result and re-runs the handler from the
// top on a retry, replaying stored results; a step whose reply never reached
// Inngest runs again.
// https://www.inngest.com/docs/learn/how-functions-are-executed
async function runSweep(input: {
  stepIdsWhoseReplyIsLost?: string[];
  beforeStep?: (stepId: string) => void;
} = {}): Promise<unknown> {
  const finishedSteps = new Map<string, unknown>();
  const repliesToLose = new Set(input.stepIdsWhoseReplyIsLost ?? []);
  const memoizingStep = {
    run: async (stepId: string, stepBody: () => Promise<unknown>) => {
      if (finishedSteps.has(stepId)) return finishedSteps.get(stepId);
      input.beforeStep?.(stepId);
      const stepResult = await stepBody();
      if (repliesToLose.delete(stepId)) throw new FunctionKilled(`reply of ${stepId} lost`);
      finishedSteps.set(stepId, stepResult);
      return stepResult;
    },
  };
  let lastError: unknown = new Error("no attempt ran");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await sweepFunction.handler({ step: memoizingStep, attempt });
    } catch (attemptError) {
      lastError = attemptError;
    }
  }
  throw lastError;
}

const UNCLAIMED_SWEPT_PAYLOAD = {
  dispatch_id: "dispatch-stuck",
  batch_id: "batch-1",
  platform: "linkedin",
  social_account_id: "account-1",
  reason: "unknown",
  error_message: SWEPT_UNCLAIMED_MESSAGE,
  may_have_published: false,
};

const ABANDONED_CLAIM_SWEPT_PAYLOAD = {
  dispatch_id: "dispatch-abandoned",
  batch_id: "batch-2",
  platform: "tiktok",
  social_account_id: "account-2",
  reason: "unknown",
  error_message: SWEPT_MESSAGE,
  may_have_published: true,
};

function listFailedPayloadsByDispatch(): Map<unknown, number> {
  const firedCountByDispatch = new Map<unknown, number>();
  for (const sentWebhook of sentWebhooks) {
    if (sentWebhook.eventType !== "post.failed") continue;
    for (const payload of sentWebhook.payloads) {
      firedCountByDispatch.set(payload.dispatch_id, (firedCountByDispatch.get(payload.dispatch_id) ?? 0) + 1);
    }
  }
  return firedCountByDispatch;
}

const STUCK_UNCLAIMED = buildDispatchRow({ event_id: "dispatch-stuck", principal_id: "principal-1" });
const STUCK_ABANDONED_CLAIM = buildDispatchRow({
  event_id: "dispatch-abandoned",
  principal_id: "principal-2",
  batch_id: "batch-2",
  social_account_id: "account-2",
  platform: "tiktok",
  publish_started_at: minutesAgo(80),
});
const FRESH_DISPATCH = buildDispatchRow({ event_id: "dispatch-fresh", created_at: minutesAgo(5) });
const FRESH_CLAIM = buildDispatchRow({ event_id: "dispatch-publishing", publish_started_at: minutesAgo(2) });

beforeEach(() => {
  fakePostgres.tables.set("pending_direct_posts", [
    STUCK_UNCLAIMED,
    STUCK_ABANDONED_CLAIM,
    FRESH_DISPATCH,
    FRESH_CLAIM,
  ]);
  fakePostgres.faults.length = 0;
  sentWebhooks.length = 0;
});

describe("sweepStuckDirectPosts", () => {
  test("each dispatch the sweep fails fires post.failed with its dispatch ids, and only the stuck rows are failed", async () => {
    await runSweep();
    expect(readDispatch("dispatch-stuck")?.status).toBe("failed");
    expect(readDispatch("dispatch-abandoned")?.status).toBe("failed");
    expect(readDispatch("dispatch-fresh")?.status).toBe("processing");
    expect(readDispatch("dispatch-publishing")?.status).toBe("processing");
    expect(sentWebhooks).toEqual([
      { principalId: "principal-1", eventType: "post.failed", payloads: [UNCLAIMED_SWEPT_PAYLOAD] },
      { principalId: "principal-2", eventType: "post.failed", payloads: [ABANDONED_CLAIM_SWEPT_PAYLOAD] },
    ]);
  });

  test("a swept dispatch whose publish claim was never taken says it was not published", async () => {
    fakePostgres.tables.set("pending_direct_posts", [STUCK_UNCLAIMED]);
    await runSweep();
    expect(sentWebhooks).toEqual([
      { principalId: "principal-1", eventType: "post.failed", payloads: [UNCLAIMED_SWEPT_PAYLOAD] },
    ]);
  });

  test("a swept dispatch whose publish claim was taken says it may have published", async () => {
    fakePostgres.tables.set("pending_direct_posts", [STUCK_ABANDONED_CLAIM]);
    await runSweep();
    expect(sentWebhooks).toEqual([
      { principalId: "principal-2", eventType: "post.failed", payloads: [ABANDONED_CLAIM_SWEPT_PAYLOAD] },
    ]);
  });

  test("the stored record says not published when no claim was taken, may have published when one was", async () => {
    await runSweep();
    expect(readDispatch("dispatch-stuck")?.failure_reason).toBe(SWEPT_UNCLAIMED_MESSAGE);
    expect(readDispatch("dispatch-abandoned")?.failure_reason).toBe(SWEPT_MESSAGE);
  });

  test("a sweep whose write committed but whose reply was lost fires post.failed once per dispatch on the retry", async () => {
    await runSweep({ stepIdsWhoseReplyIsLost: ["mark-stuck-dispatches-failed"] });
    expect(listFailedPayloadsByDispatch()).toEqual(
      new Map([
        ["dispatch-stuck", 1],
        ["dispatch-abandoned", 1],
      ]),
    );
  });

  test("the next hourly sweep fires nothing again for a dispatch already swept", async () => {
    await runSweep();
    await runSweep();
    expect(listFailedPayloadsByDispatch()).toEqual(
      new Map([
        ["dispatch-stuck", 1],
        ["dispatch-abandoned", 1],
      ]),
    );
  });

  test("a dispatch its run records between the lookup and the write is neither failed nor notified", async () => {
    await runSweep({
      beforeStep: (stepId) => {
        if (stepId !== "mark-stuck-dispatches-failed") return;
        const tableRows = fakePostgres.tables.get("pending_direct_posts") ?? [];
        fakePostgres.tables.set(
          "pending_direct_posts",
          tableRows.map((row) => (row.event_id === "dispatch-stuck" ? { ...row, status: "completed" } : row)),
        );
      },
    });
    expect(readDispatch("dispatch-stuck")?.status).toBe("completed");
    expect(listFailedPayloadsByDispatch()).toEqual(new Map([["dispatch-abandoned", 1]]));
  });

  test("a failed lookup throws inside its step so Inngest retries it", async () => {
    fakePostgres.faults.push(
      { statementPrefix: "", message: "connection reset" },
      { statementPrefix: "", message: "connection reset" },
      { statementPrefix: "", message: "connection reset" },
    );
    await expect(runSweep()).rejects.toThrow("sweep-failure");
    expect(readDispatch("dispatch-stuck")?.status).toBe("processing");
    expect(sentWebhooks).toEqual([]);
  });

  test("a sweep that finds nothing stuck fires nothing", async () => {
    fakePostgres.tables.set("pending_direct_posts", [FRESH_DISPATCH, FRESH_CLAIM]);
    await runSweep();
    expect(sentWebhooks).toEqual([]);
  });
});
