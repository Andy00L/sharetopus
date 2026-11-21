import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { DirectPostOutcome } from "@/actions/server/data/pendingDirectPosts";
import type { PostNowEventData } from "@/inngest/events/postNow";

type LockState = {
  batch_id: string;
  social_account_id: string;
  platform: "linkedin";
  status: "processing" | "completed" | "failed";
  created_at: string;
};

type PublishResult =
  | { ok: true }
  | { ok: false; reason: string; message: string; mayHavePublished: boolean };

type MintResult =
  | { success: true; publicUrl: string | null; tiktokUrl: string | null }
  | { success: false; reason: "not_found" | "unavailable"; message: string };

const MINTED_NOTHING: MintResult = { success: true, publicUrl: null, tiktokUrl: null };

type WorkerState = {
  lock: LockState | null;
  mintResult: MintResult;
  isInHistory: boolean;
  isFinalizeFailing: boolean;
  platformResult: PublishResult;
  platformCalls: number;
  finalizedOutcomes: DirectPostOutcome[];
  cleanupDecisions: { platform: string; mightBeLive: boolean }[];
};

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
  created_via: "web",
  request_id: null,
  post_options: null,
};

const PROCESSING_LOCK: LockState = {
  batch_id: EVENT_DATA.batch_id,
  social_account_id: EVENT_DATA.social_account_id,
  platform: "linkedin",
  status: "processing",
  created_at: "2026-11-19T10:00:00.000Z",
};

const workerState: WorkerState = {
  lock: PROCESSING_LOCK,
  mintResult: MINTED_NOTHING,
  isInHistory: false,
  isFinalizeFailing: false,
  platformResult: { ok: true },
  platformCalls: 0,
  finalizedOutcomes: [],
  cleanupDecisions: [],
};

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
  fetchAccountForPublish: async () => ({ success: true, account: { id: EVENT_DATA.social_account_id } }),
}));

mock.module("@/actions/server/data/pendingDirectPosts", () => ({
  readDirectPostLock: async () => ({ success: true, lock: workerState.lock }),
  finalizePendingDirectPost: async (input: { outcome: DirectPostOutcome }) => {
    if (workerState.isFinalizeFailing) return { success: false, message: "Update failed: timeout" };
    workerState.finalizedOutcomes.push(input.outcome);
    return { success: true, updated: true };
  },
}));

mock.module("./processDirectPostHelpers", () => ({
  findPublishedDirectPost: async () => ({ success: true, isPublished: workerState.isInHistory }),
  buildDirectPublishRequest: () => ({}),
}));

mock.module("./publishToPlatform", () => ({
  mintPublishMediaUrls: async () => workerState.mintResult,
  publishToPlatform: async () => {
    workerState.platformCalls += 1;
    return workerState.platformResult;
  },
  shouldDeleteMediaAfterPublish: (input: { platform: string; mightBeLive: boolean }) => {
    workerState.cleanupDecisions.push(input);
    return true;
  },
}));

mock.module("./processSinglePostHelpers", () => ({
  cleanupMediaIfUnreferenced: async () => ({ success: true, message: "", deleted: false }),
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

const step = {
  run: async (_stepId: string, stepBody: () => Promise<unknown>) => stepBody(),
};

const EVENT_DATA_WITH_MEDIA: PostNowEventData = {
  ...EVENT_DATA,
  post_type: "image",
  media_path: "principal-1/photo.jpg",
};

function runWorker(attempt: number, eventData: PostNowEventData = EVENT_DATA) {
  return workerFunction.handler({ event: { data: eventData }, step, attempt });
}

function runOnFailure(eventData: unknown = EVENT_DATA) {
  return workerFunction.config.onFailure({
    event: { data: { event: { data: eventData } } },
    error: new Error("boom"),
  });
}

beforeEach(() => {
  workerState.lock = PROCESSING_LOCK;
  workerState.mintResult = MINTED_NOTHING;
  workerState.isInHistory = false;
  workerState.isFinalizeFailing = false;
  workerState.platformResult = { ok: true };
  workerState.platformCalls = 0;
  workerState.finalizedOutcomes = [];
  workerState.cleanupDecisions = [];
});

describe("processDirectPost", () => {
  test("a re-executed publish step finds the post in history and does not publish twice", async () => {
    workerState.isInHistory = true;
    await runWorker(1);
    expect(workerState.platformCalls).toBe(0);
    expect(workerState.finalizedOutcomes).toEqual([{ status: "completed" }]);
  });

  test("a first attempt publishes even when a sibling to the same account is already in history", async () => {
    workerState.isInHistory = true;
    await runWorker(0);
    expect(workerState.platformCalls).toBe(1);
  });

  test("a lock swept before the publish started is never published", async () => {
    workerState.lock = { ...PROCESSING_LOCK, status: "failed" };
    await runWorker(0);
    expect(workerState.platformCalls).toBe(0);
  });

  test("a failed finalize throws so Inngest retries that step instead of leaving the lock processing", async () => {
    workerState.isFinalizeFailing = true;
    await expect(runWorker(0)).rejects.toThrow("finalize-failure");
  });

  test("a media file storage says is gone fails the post at once, an outage is retried", async () => {
    workerState.mintResult = { success: false, reason: "not_found", message: "Object not found" };
    await runWorker(0, EVENT_DATA_WITH_MEDIA);
    expect(workerState.platformCalls).toBe(0);
    expect(workerState.finalizedOutcomes).toEqual([
      { status: "failed", failureReason: "Media file no longer exists: Object not found" },
    ]);

    workerState.finalizedOutcomes = [];
    workerState.mintResult = { success: false, reason: "unavailable", message: "fetch failed" };
    await expect(runWorker(0, EVENT_DATA_WITH_MEDIA)).rejects.toThrow("signed-url-failure: fetch failed");
    expect(workerState.finalizedOutcomes).toEqual([]);
  });

  test("a rate-limited publish throws so Inngest retries it", async () => {
    workerState.platformResult = {
      ok: false,
      reason: "rate_limited",
      message: "Too many requests (429)",
      mayHavePublished: false,
    };
    await expect(runWorker(0)).rejects.toThrow("retryable: rate_limited");
    expect(workerState.finalizedOutcomes).toEqual([]);
  });

  test("a failure that may have published is recorded failed, never retried", async () => {
    workerState.platformResult = {
      ok: false,
      reason: "unknown",
      message: "publish request failed (502)",
      mayHavePublished: true,
    };
    await runWorker(0);
    expect(workerState.finalizedOutcomes).toEqual([
      { status: "failed", failureReason: "publish request failed (502)" },
    ]);
  });

  test("media cleanup treats a failure that may have published as possibly live", async () => {
    workerState.platformResult = {
      ok: false,
      reason: "unknown",
      message: "publish request failed (502)",
      mayHavePublished: true,
    };
    await runWorker(0, EVENT_DATA_WITH_MEDIA);
    workerState.platformResult = {
      ok: false,
      reason: "policy_rejected",
      message: "Rejected",
      mayHavePublished: false,
    };
    await runWorker(0, EVENT_DATA_WITH_MEDIA);
    expect(workerState.cleanupDecisions).toEqual([
      { platform: "linkedin", mightBeLive: true },
      { platform: "linkedin", mightBeLive: false },
    ]);
  });
});

describe("processDirectPost onFailure", () => {
  test("exhausted retries record the lock failed with the last error", async () => {
    await runOnFailure();
    expect(workerState.finalizedOutcomes).toEqual([
      { status: "failed", failureReason: "Retries exhausted: boom" },
    ]);
  });

  test("exhausted retries record a post found in history as completed", async () => {
    workerState.isInHistory = true;
    await runOnFailure();
    expect(workerState.finalizedOutcomes).toEqual([{ status: "completed" }]);
  });

  test("exhausted retries still record the outcome when the sweeper failed the lock first", async () => {
    workerState.lock = { ...PROCESSING_LOCK, status: "failed" };
    workerState.isInHistory = true;
    await runOnFailure();
    expect(workerState.finalizedOutcomes).toEqual([{ status: "completed" }]);
  });

  test("exhausted retries treat the post as possibly live for media cleanup", async () => {
    await runOnFailure(EVENT_DATA_WITH_MEDIA);
    expect(workerState.cleanupDecisions).toEqual([{ platform: "linkedin", mightBeLive: true }]);
  });

  test("a failure event without readable post.now data finalizes nothing", async () => {
    const result = await runOnFailure({ dispatch_id: "dispatch-1" });
    expect(result).toEqual({ finalized: false, reason: "unreadable_event" });
    expect(workerState.finalizedOutcomes).toEqual([]);
  });
});
