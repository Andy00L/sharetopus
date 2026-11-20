import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { DirectPostOutcome } from "@/actions/server/data/pendingDirectPosts";
import type { PostNowEventData } from "./processDirectPostHelpers";

type LockState = {
  batch_id: string;
  social_account_id: string;
  platform: "linkedin";
  status: "processing" | "completed" | "failed";
  created_at: string;
};

type WorkerState = {
  lock: LockState | null;
  isInHistory: boolean;
  isFinalizeFailing: boolean;
  platformResult: { success: boolean; message: string | null; contentId: string | null };
  platformCalls: number;
  finalizedOutcomes: DirectPostOutcome[];
};

const EVENT_DATA: PostNowEventData = {
  batch_id: "batch-1",
  principal_id: "principal-1",
  social_account_id: "account-1",
  platform: "linkedin",
  post_type: "text",
  account_content: {
    accountId: "account-1",
    title: "",
    description: "hello",
    link: "",
    isCustomized: true,
  },
  platform_options: {},
  board: null,
  cover_timestamp: 0,
  file_name: "",
  media_type: "",
  media_path: "",
  media_url: null,
  tiktok_media_url: null,
  dispatch_id: "dispatch-1",
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
  isInHistory: false,
  isFinalizeFailing: false,
  platformResult: { success: true, message: null, contentId: EVENT_DATA.batch_id },
  platformCalls: 0,
  finalizedOutcomes: [],
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

mock.module("@/lib/platforms/capabilities", () => ({
  platformHotlinksMedia: () => false,
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
  postNowEvent: { event: "post.now" },
  findPublishedDirectPost: async () => ({ success: true, isPublished: workerState.isInHistory }),
  callDirectPostFromEvent: async () => {
    workerState.platformCalls += 1;
    return workerState.platformResult;
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

function runWorker(attempt: number) {
  return workerFunction.handler({ event: { data: EVENT_DATA }, step, attempt });
}

function runOnFailure() {
  return workerFunction.config.onFailure({
    event: { data: { event: { data: EVENT_DATA } } },
    error: new Error("boom"),
  });
}

beforeEach(() => {
  workerState.lock = PROCESSING_LOCK;
  workerState.isInHistory = false;
  workerState.isFinalizeFailing = false;
  workerState.platformResult = { success: true, message: null, contentId: EVENT_DATA.batch_id };
  workerState.platformCalls = 0;
  workerState.finalizedOutcomes = [];
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

  test("a rate-limited publish throws so Inngest retries it", async () => {
    workerState.platformResult = { success: false, message: "Too many requests (429)", contentId: null };
    await expect(runWorker(0)).rejects.toThrow("retryable: rate_limited");
    expect(workerState.finalizedOutcomes).toEqual([]);
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
});
