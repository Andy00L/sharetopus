import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { DirectPostOutcome } from "@/actions/server/data/pendingDirectPosts";
import type { PostNowEventData } from "@/inngest/events/postNow";

type DispatchStatus = "processing" | "completed" | "failed";

type DispatchRow = {
  batch_id: string;
  social_account_id: string;
  platform: "linkedin";
  status: DispatchStatus;
  failure_reason: string | null;
  created_at: string;
  publish_started_at: string | null;
};

type PublishResult =
  | { ok: true }
  | { ok: false; reason: string; message: string; mayHavePublished: boolean };

type MintResult =
  | { success: true; publicUrl: string | null; tiktokUrl: string | null }
  | { success: false; reason: "not_found" | "unavailable"; message: string };

type AccountResult =
  | { success: true; account: { id: string } }
  | { success: false; reason: "not_found" | "lookup_failed"; message: string };

type SentWebhook = { principalId: string; eventType: string; payload: Record<string, unknown> };

type CallEnding = "answer" | "killed-before-history" | "killed-after-history";

const MINTED_NOTHING: MintResult = { success: true, publicUrl: null, tiktokUrl: null };
const STALE_WORKER_SWEPT_REASON = "stale_worker_swept";
const SWEPT_DIRECT_POST_REASON = "Publishing stopped without a result; the post may have published";
const SWEPT_UNCLAIMED_DIRECT_POST_REASON =
  "Publishing never started before the hourly sweep; the post was not published";
const CLAIM_TIME = "2026-11-19T10:00:01.000Z";
const MAY_HAVE_PUBLISHED_MESSAGE =
  "An earlier publish attempt stopped before it reported a result; the post may have published";

const EVENT_DATA: PostNowEventData = {
  dispatch_id: "dispatch-1",
  batch_id: "batch-1",
  principal_id: "principal-1",
  social_account_id: "account-1",
  platform: "linkedin",
  post_type: "text",
  account_content: { title: "", description: "hello", link: "" },
  platform_options: {},
  board: null,
  cover_timestamp: null,
  media_path: "",
  created_via: "api",
  request_id: null,
  post_options: null,
};

const EVENT_DATA_WITH_MEDIA: PostNowEventData = {
  ...EVENT_DATA,
  post_type: "image",
  media_path: "principal-1/photo.jpg",
};

const PROCESSING_ROW: DispatchRow = {
  batch_id: EVENT_DATA.batch_id,
  social_account_id: EVENT_DATA.social_account_id,
  platform: "linkedin",
  status: "processing",
  failure_reason: null,
  created_at: "2026-11-19T10:00:00.000Z",
  publish_started_at: null,
};

const RATE_LIMITED: PublishResult = {
  ok: false,
  reason: "rate_limited",
  message: "Too many requests (429)",
  mayHavePublished: false,
};

const UNCLEAR_ANSWER: PublishResult = {
  ok: false,
  reason: "unknown",
  message: "publish request failed (502)",
  mayHavePublished: true,
};

type World = {
  row: DispatchRow | null;
  historyRows: number;
  accountResult: AccountResult;
  mintResult: MintResult;
  platformAnswers: PublishResult[];
  callEndings: CallEnding[];
  platformCalls: number;
  isFinalizeFailing: boolean;
  isReleaseFailing: boolean;
  finalizedOutcomes: DirectPostOutcome[];
  webhooks: SentWebhook[];
  cleanupDecisions: { platform: string; mightBeLive: boolean }[];
};

const world: World = {
  row: PROCESSING_ROW,
  historyRows: 0,
  accountResult: { success: true, account: { id: EVENT_DATA.social_account_id } },
  mintResult: MINTED_NOTHING,
  platformAnswers: [],
  callEndings: [],
  platformCalls: 0,
  isFinalizeFailing: false,
  isReleaseFailing: false,
  finalizedOutcomes: [],
  webhooks: [],
  cleanupDecisions: [],
};

class FunctionKilled extends Error {}

function isFinalizable(row: DispatchRow): boolean {
  return (
    row.status === "processing" ||
    (row.status === "failed" && row.failure_reason === STALE_WORKER_SWEPT_REASON)
  );
}

type UnclaimableKind = "dispatch-gone" | "already-published" | "attempt-already-started" | "already-failed";

function classifyUnclaimableRow(row: DispatchRow | null): { success: true; kind: UnclaimableKind } {
  if (row === null) return { success: true, kind: "dispatch-gone" };
  if (row.status === "completed") return { success: true, kind: "already-published" };
  if (row.publish_started_at !== null) return { success: true, kind: "attempt-already-started" };
  return { success: true, kind: "already-failed" };
}

mock.module("server-only", () => ({}));

mock.module("@/inngest/client", () => ({
  inngest: {
    createFunction: (
      config: { onFailure: (input: unknown) => Promise<unknown> },
      handler: (input: unknown) => Promise<unknown>,
    ) => ({ config, handler }),
  },
}));

mock.module("@/actions/server/data/fetchAccountForPublish", () => ({
  fetchAccountForPublish: async () => world.accountResult,
}));

mock.module("@/actions/server/data/pendingDirectPosts", () => ({
  isSweptDirectPostReason: (failureReason: string | null) =>
    failureReason === SWEPT_DIRECT_POST_REASON || failureReason === SWEPT_UNCLAIMED_DIRECT_POST_REASON,
  finalizePendingDirectPost: async (input: { outcome: DirectPostOutcome }) => {
    if (world.isFinalizeFailing) return { success: false, message: "Update failed: timeout" };
    const row = world.row;
    if (row === null || !isFinalizable(row)) return { success: true, updated: false };
    world.finalizedOutcomes.push(input.outcome);
    world.row = {
      ...row,
      status: input.outcome.status,
      failure_reason: input.outcome.status === "failed" ? input.outcome.failureReason : null,
    };
    return { success: true, updated: true };
  },
}));

mock.module("./processDirectPostHelpers", () => ({
  findPublishedDirectPost: async () => ({ success: true, isPublished: world.historyRows > 0 }),
  buildDirectPublishRequest: () => ({}),
  readDirectDispatch: async () => ({ success: true, dispatch: world.row }),
  claimDirectPublishAttempt: async () => {
    const row = world.row;
    if (row !== null && row.status === "processing" && row.publish_started_at === null) {
      world.row = { ...row, publish_started_at: CLAIM_TIME };
      return { success: true, kind: "claimed" };
    }
    return classifyUnclaimableRow(row);
  },
  releaseDirectPublishAttempt: async () => {
    if (world.isReleaseFailing) return { success: false, message: "publish release failed: timeout" };
    if (world.row !== null) world.row = { ...world.row, publish_started_at: null };
    return { success: true };
  },
}));

mock.module("./publishToPlatform", () => ({
  mintPublishMediaUrls: async () => world.mintResult,
  publishToPlatform: async () => {
    world.platformCalls += 1;
    const answer = world.platformAnswers.shift() ?? { ok: true };
    const ending = world.callEndings.shift() ?? "answer";
    if (ending === "killed-before-history") throw new FunctionKilled("killed during the platform call");
    if (answer.ok) world.historyRows += 1;
    if (ending === "killed-after-history") throw new FunctionKilled("killed after the history row");
    return answer;
  },
  shouldDeleteMediaAfterPublish: (input: { platform: string; mightBeLive: boolean }) => {
    world.cleanupDecisions.push(input);
    return true;
  },
}));

mock.module("./processSinglePostHelpers", () => ({
  cleanupMediaIfUnreferenced: async () => ({ success: true, message: "", deleted: false }),
}));

mock.module("@/lib/api/rest/webhooks/dispatch", () => ({
  dispatchWebhook: async (principalId: string, eventType: string, payload: Record<string, unknown>) => {
    world.webhooks.push({ principalId, eventType, payload });
  },
}));

const { processDirectPost } = await import("./processDirectPost");

type CapturedFunction = {
  config: { onFailure: (input: unknown) => Promise<unknown> };
  handler: (input: unknown) => Promise<unknown>;
};

function isCapturedFunction(candidate: unknown): candidate is CapturedFunction {
  return typeof candidate === "object" && candidate !== null && "handler" in candidate;
}

function readCapturedFunction(candidate: unknown): CapturedFunction {
  if (!isCapturedFunction(candidate)) throw new Error("createFunction mock not applied");
  return candidate;
}

const workerFunction = readCapturedFunction(processDirectPost);

const unmemoizedStep = {
  run: async (_stepId: string, stepBody: () => Promise<unknown>) => stepBody(),
};

function runWorker(attempt: number, eventData: PostNowEventData = EVENT_DATA) {
  return workerFunction.handler({ event: { data: eventData }, step: unmemoizedStep, attempt });
}

function runOnFailure(eventData: unknown = EVENT_DATA, lastError = new Error("boom")) {
  return workerFunction.config.onFailure({
    event: { data: { event: { data: eventData } } },
    error: lastError,
  });
}

// Inngest stores each finished step's result and re-runs the handler from the
// top on a retry, replaying stored results; a step that threw runs again, and
// once retries run out it calls onFailure with the last error.
// https://www.inngest.com/docs/learn/how-functions-are-executed
async function runWithRetries(input: {
  attempts: number;
  eventData?: PostNowEventData;
  stepIdsWhoseReplyIsLost?: string[];
}) {
  const finishedSteps = new Map<string, unknown>();
  const repliesToLose = new Set(input.stepIdsWhoseReplyIsLost ?? []);
  const memoizingStep = {
    run: async (stepId: string, stepBody: () => Promise<unknown>) => {
      if (finishedSteps.has(stepId)) return finishedSteps.get(stepId);
      const stepResult = await stepBody();
      if (repliesToLose.delete(stepId)) throw new FunctionKilled(`reply of ${stepId} lost`);
      finishedSteps.set(stepId, stepResult);
      return stepResult;
    },
  };
  const eventData = input.eventData ?? EVENT_DATA;
  let lastError = new Error("no attempt ran");
  for (let attempt = 0; attempt < input.attempts; attempt += 1) {
    try {
      return await workerFunction.handler({ event: { data: eventData }, step: memoizingStep, attempt });
    } catch (stepError) {
      lastError = stepError instanceof Error ? stepError : new Error(String(stepError));
    }
  }
  return runOnFailure(eventData, lastError);
}

beforeEach(() => {
  world.row = PROCESSING_ROW;
  world.historyRows = 0;
  world.accountResult = { success: true, account: { id: EVENT_DATA.social_account_id } };
  world.mintResult = MINTED_NOTHING;
  world.platformAnswers = [];
  world.callEndings = [];
  world.platformCalls = 0;
  world.isFinalizeFailing = false;
  world.isReleaseFailing = false;
  world.finalizedOutcomes = [];
  world.webhooks = [];
  world.cleanupDecisions = [];
});

describe("processDirectPost", () => {
  test("a re-executed publish step finds the post in history and does not publish twice", async () => {
    world.historyRows = 1;
    await runWorker(1);
    expect(world.platformCalls).toBe(0);
    expect(world.finalizedOutcomes).toEqual([{ status: "completed" }]);
  });

  test("a first attempt publishes even when a sibling to the same account is already in history", async () => {
    world.historyRows = 1;
    await runWorker(0);
    expect(world.platformCalls).toBe(1);
  });

  test("a dispatch swept before the publish started is never published, and the sweep's record stays", async () => {
    world.row = { ...PROCESSING_ROW, status: "failed", failure_reason: SWEPT_DIRECT_POST_REASON };
    await runWorker(0);
    expect(world.platformCalls).toBe(0);
    expect(world.row?.failure_reason).toBe(SWEPT_DIRECT_POST_REASON);
  });

  test("a row an older sweep marked stale_worker_swept is still overwritten by its run", async () => {
    world.row = { ...PROCESSING_ROW, status: "failed", failure_reason: STALE_WORKER_SWEPT_REASON };
    await runWorker(0);
    expect(world.platformCalls).toBe(0);
    expect(world.row?.failure_reason).toBe("Not published: the post was already marked failed");
  });

  test("a failed finalize throws so Inngest retries that step instead of leaving the dispatch processing", async () => {
    world.isFinalizeFailing = true;
    await expect(runWorker(0)).rejects.toThrow("finalize-failure");
  });

  test("a media file storage says is gone fails the post at once, an outage is retried", async () => {
    world.mintResult = { success: false, reason: "not_found", message: "Object not found" };
    await runWorker(0, EVENT_DATA_WITH_MEDIA);
    expect(world.platformCalls).toBe(0);
    expect(world.finalizedOutcomes).toEqual([
      { status: "failed", failureReason: "Media file no longer exists: Object not found" },
    ]);

    world.row = PROCESSING_ROW;
    world.finalizedOutcomes = [];
    world.mintResult = { success: false, reason: "unavailable", message: "fetch failed" };
    await expect(runWorker(0, EVENT_DATA_WITH_MEDIA)).rejects.toThrow("signed-url-failure: fetch failed");
    expect(world.finalizedOutcomes).toEqual([]);
  });

  test("a rate-limited publish throws so Inngest retries it", async () => {
    world.platformAnswers = [RATE_LIMITED];
    await expect(runWorker(0)).rejects.toThrow("retryable: rate_limited");
    expect(world.finalizedOutcomes).toEqual([]);
  });

  test("a failure that may have published is recorded failed, never retried", async () => {
    world.platformAnswers = [UNCLEAR_ANSWER];
    await runWorker(0);
    expect(world.finalizedOutcomes).toEqual([
      { status: "failed", failureReason: "publish request failed (502)" },
    ]);
  });

  test("media cleanup treats a failure that may have published as possibly live", async () => {
    world.platformAnswers = [UNCLEAR_ANSWER];
    await runWorker(0, EVENT_DATA_WITH_MEDIA);
    world.row = PROCESSING_ROW;
    world.platformAnswers = [
      { ok: false, reason: "policy_rejected", message: "Rejected", mayHavePublished: false },
    ];
    await runWorker(0, EVENT_DATA_WITH_MEDIA);
    expect(world.cleanupDecisions).toEqual([
      { platform: "linkedin", mightBeLive: true },
      { platform: "linkedin", mightBeLive: false },
    ]);
  });
});

describe("processDirectPost publish claim", () => {
  test("a retry after an attempt killed during the platform call never calls the platform again", async () => {
    world.callEndings = ["killed-before-history"];
    await runWithRetries({ attempts: 4 });
    expect(world.platformCalls).toBe(1);
    expect(world.row?.status).toBe("failed");
    expect(world.row?.failure_reason).toBe(MAY_HAVE_PUBLISHED_MESSAGE);
  });

  test("a retry after an attempt killed once the history row was saved records the post published", async () => {
    world.callEndings = ["killed-after-history"];
    await runWithRetries({ attempts: 4 });
    expect(world.platformCalls).toBe(1);
    expect(world.row?.status).toBe("completed");
  });

  test("a try-later answer releases the claim, so the retry publishes once", async () => {
    world.platformAnswers = [RATE_LIMITED, { ok: true }];
    await runWithRetries({ attempts: 4 });
    expect(world.platformCalls).toBe(2);
    expect(world.row?.status).toBe("completed");
  });

  test("a try-later answer whose release fails ends as may have published, with no second call", async () => {
    world.isReleaseFailing = true;
    world.platformAnswers = [RATE_LIMITED, { ok: true }];
    await runWithRetries({ attempts: 4 });
    expect(world.platformCalls).toBe(1);
    expect(world.row?.failure_reason).toBe(MAY_HAVE_PUBLISHED_MESSAGE);
  });

  test("a refused account leaves no claim, since the claim comes right before the platform call", async () => {
    world.accountResult = { success: false, reason: "not_found", message: "Social account not found" };
    await runWorker(0);
    expect(world.platformCalls).toBe(0);
    expect(world.row?.publish_started_at).toBeNull();
  });

  test("a dispatch swept after an attempt that may have published is never called again", async () => {
    world.row = {
      ...PROCESSING_ROW,
      status: "failed",
      failure_reason: SWEPT_DIRECT_POST_REASON,
      publish_started_at: CLAIM_TIME,
    };
    await runWorker(1);
    expect(world.platformCalls).toBe(0);
    expect(world.row?.failure_reason).toBe(SWEPT_DIRECT_POST_REASON);
  });
});

describe("processDirectPost onFailure", () => {
  test("exhausted retries record the dispatch failed with the last error", async () => {
    await runOnFailure();
    expect(world.finalizedOutcomes).toEqual([
      { status: "failed", failureReason: "Retries exhausted: boom" },
    ]);
  });

  test("exhausted retries after an attempt that held the claim say the post may have published", async () => {
    world.row = { ...PROCESSING_ROW, publish_started_at: CLAIM_TIME };
    await runOnFailure();
    expect(world.finalizedOutcomes).toEqual([
      { status: "failed", failureReason: `Retries exhausted: boom. ${MAY_HAVE_PUBLISHED_MESSAGE}` },
    ]);
  });

  test("exhausted retries record a post found in history as completed", async () => {
    world.historyRows = 1;
    await runOnFailure();
    expect(world.finalizedOutcomes).toEqual([{ status: "completed" }]);
  });

  test("exhausted retries leave a dispatch the sweep failed as the sweep recorded it", async () => {
    world.row = { ...PROCESSING_ROW, status: "failed", failure_reason: SWEPT_DIRECT_POST_REASON };
    world.historyRows = 1;
    await runOnFailure();
    expect(world.finalizedOutcomes).toEqual([]);
    expect(world.row?.failure_reason).toBe(SWEPT_DIRECT_POST_REASON);
  });

  test("exhausted retries leave a dispatch the sweep failed before any claim as the sweep recorded it", async () => {
    world.row = { ...PROCESSING_ROW, status: "failed", failure_reason: SWEPT_UNCLAIMED_DIRECT_POST_REASON };
    await runOnFailure();
    expect(world.finalizedOutcomes).toEqual([]);
    expect(world.row?.failure_reason).toBe(SWEPT_UNCLAIMED_DIRECT_POST_REASON);
  });

  test("exhausted retries treat the post as possibly live for media cleanup", async () => {
    await runOnFailure(EVENT_DATA_WITH_MEDIA);
    expect(world.cleanupDecisions).toEqual([{ platform: "linkedin", mightBeLive: true }]);
  });

  test("a failure event without readable post.now data finalizes nothing", async () => {
    const result = await runOnFailure({ dispatch_id: "dispatch-1" });
    expect(result).toEqual({ finalized: false, reason: "unreadable_event" });
    expect(world.finalizedOutcomes).toEqual([]);
  });
});

describe("processDirectPost webhooks", () => {
  const DISPATCH_FIELDS = {
    dispatch_id: EVENT_DATA.dispatch_id,
    batch_id: EVENT_DATA.batch_id,
    platform: EVENT_DATA.platform,
    social_account_id: EVENT_DATA.social_account_id,
  };

  test("a published post-now fires post.published with the dispatch id and the batch id", async () => {
    await runWithRetries({ attempts: 4 });
    expect(world.webhooks).toEqual([
      { principalId: EVENT_DATA.principal_id, eventType: "post.published", payload: DISPATCH_FIELDS },
    ]);
  });

  test("a refused post-now fires post.failed with the reason and the message", async () => {
    world.platformAnswers = [
      { ok: false, reason: "policy_rejected", message: "Rejected", mayHavePublished: false },
    ];
    await runWithRetries({ attempts: 4 });
    expect(world.webhooks).toEqual([
      {
        principalId: EVENT_DATA.principal_id,
        eventType: "post.failed",
        payload: {
          ...DISPATCH_FIELDS,
          reason: "policy_rejected",
          error_message: "Rejected",
          may_have_published: false,
        },
      },
    ]);
  });

  test("a failure that may have published says so in post.failed", async () => {
    world.callEndings = ["killed-before-history"];
    await runWithRetries({ attempts: 4 });
    expect(world.webhooks).toEqual([
      {
        principalId: EVENT_DATA.principal_id,
        eventType: "post.failed",
        payload: {
          ...DISPATCH_FIELDS,
          reason: "unknown",
          error_message: MAY_HAVE_PUBLISHED_MESSAGE,
          may_have_published: true,
        },
      },
    ]);
  });

  test("a finalize saved before its reply was lost still fires its webhook, once", async () => {
    await runWithRetries({ attempts: 4, stepIdsWhoseReplyIsLost: ["finalize-pending-direct-post"] });
    expect(world.finalizedOutcomes).toEqual([{ status: "completed" }]);
    expect(world.webhooks.map((webhook) => webhook.eventType)).toEqual(["post.published"]);
  });

  test("exhausted retries fire post.failed for the outcome they record", async () => {
    world.row = { ...PROCESSING_ROW, publish_started_at: CLAIM_TIME };
    await runOnFailure();
    expect(world.webhooks).toEqual([
      {
        principalId: EVENT_DATA.principal_id,
        eventType: "post.failed",
        payload: {
          ...DISPATCH_FIELDS,
          reason: "unknown",
          error_message: `Retries exhausted: boom. ${MAY_HAVE_PUBLISHED_MESSAGE}`,
          may_have_published: true,
        },
      },
    ]);
  });

  test("an expired login fires post.failed and connection.expired once, even when the finalize reply was lost", async () => {
    world.platformAnswers = [
      { ok: false, reason: "auth_expired", message: "Token expired", mayHavePublished: false },
    ];
    await runWithRetries({ attempts: 4, stepIdsWhoseReplyIsLost: ["finalize-pending-direct-post"] });
    expect(world.webhooks).toEqual([
      {
        principalId: EVENT_DATA.principal_id,
        eventType: "post.failed",
        payload: {
          ...DISPATCH_FIELDS,
          reason: "auth_expired",
          error_message: "Token expired",
          may_have_published: false,
        },
      },
      {
        principalId: EVENT_DATA.principal_id,
        eventType: "connection.expired",
        payload: {
          social_account_id: EVENT_DATA.social_account_id,
          platform: EVENT_DATA.platform,
          reason: "auth_expired",
        },
      },
    ]);
  });

  test("a run that ends after the sweep failed its dispatch fires no second post.failed", async () => {
    world.row = {
      ...PROCESSING_ROW,
      status: "failed",
      failure_reason: SWEPT_DIRECT_POST_REASON,
      publish_started_at: CLAIM_TIME,
    };
    await runWithRetries({ attempts: 4 });
    world.row = { ...PROCESSING_ROW, status: "failed", failure_reason: SWEPT_DIRECT_POST_REASON };
    world.historyRows = 1;
    await runWithRetries({ attempts: 4 });
    await runOnFailure();
    expect(world.webhooks).toEqual([]);
  });

  test("a dispatch whose row is gone or already recorded fires nothing", async () => {
    world.row = null;
    await runWithRetries({ attempts: 4 });
    world.row = { ...PROCESSING_ROW, status: "failed", failure_reason: "Rejected" };
    await runOnFailure();
    expect(world.webhooks).toEqual([]);
  });
});
