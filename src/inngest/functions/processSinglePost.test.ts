import { beforeEach, describe, expect, mock, test } from "bun:test";

type Outcome =
  | { ok: true; contentId: string }
  | { ok: false; reason: string; message: string; mayHavePublished: boolean };

type PublishResult = { ok: true } | Extract<Outcome, { ok: false }>;

type PostRow = {
  id: string;
  status: string;
  batch_id: string | null;
  social_account_id: string;
  principal_id: string;
  platform: string;
  media_type: string;
  media_storage_path: string;
};

const POST: PostRow = {
  id: "post-1",
  status: "queued",
  batch_id: "batch-1",
  social_account_id: "account-1",
  principal_id: "principal-1",
  platform: "linkedin",
  media_type: "text",
  media_storage_path: "",
};

const EVENT_DATA = {
  scheduled_post_id: POST.id,
  principal_id: POST.principal_id,
  social_account_id: POST.social_account_id,
  platform: POST.platform,
  scheduled_at: "2026-11-19T10:00:00+00:00",
};

type LoadResult =
  | { kind: "ready" | "account_missing"; post: PostRow }
  | { kind: "terminal" | "lookup_failed"; message: string };

type ClaimInput = { scheduledPostId: string; dispatchedScheduledAt: string };

type HelperState = {
  load: LoadResult;
  claim: { success: true; claimed: boolean } | { success: false; message: string };
  isPublished: boolean;
  claimCalls: ClaimInput[];
  recorded: Outcome[];
  platformCalls: number;
  publishResult: PublishResult;
  cleanupDecisions: { platform: string; mightBeLive: boolean }[];
  shouldDeleteMedia: boolean;
  stepLog: string[];
};

const helperState: HelperState = {
  load: { kind: "ready", post: POST },
  claim: { success: true, claimed: true },
  isPublished: false,
  claimCalls: [],
  recorded: [],
  platformCalls: 0,
  publishResult: { ok: true },
  cleanupDecisions: [],
  shouldDeleteMedia: true,
  stepLog: [],
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
  fetchAccountForPublish: async () => ({ success: true, account: { id: POST.social_account_id } }),
}));

mock.module("./processSinglePostHelpers", () => ({
  loadPostForProcessing: async () => helperState.load,
  claimPostForProcessing: async (input: ClaimInput) => {
    helperState.claimCalls.push(input);
    return helperState.claim;
  },
  findPublishedContentHistory: async () => ({ success: true, isPublished: helperState.isPublished }),
  checkPlatformCompatibility: () => ({ compatible: true, reason: "" }),
  buildScheduledPublishRequest: () => ({ ok: true, request: {} }),
  recordPostStatus: async (input: { result: Outcome }) => {
    helperState.recorded.push(input.result);
    return { success: true, updated: true };
  },
  cleanupMediaIfUnreferenced: async () => ({ success: true, deleted: false }),
}));

mock.module("./publishToPlatform", () => ({
  mintPublishMediaUrls: async () => ({ success: true, publicUrl: null, tiktokUrl: null }),
  publishToPlatform: async (): Promise<PublishResult> => {
    helperState.platformCalls += 1;
    return helperState.publishResult;
  },
  shouldDeleteMediaAfterPublish: (input: { platform: string; mightBeLive: boolean }) => {
    helperState.cleanupDecisions.push(input);
    return helperState.shouldDeleteMedia;
  },
}));

const { processSinglePost } = await import("./processSinglePost");

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

const workerFunction = readCapturedFunction(processSinglePost);

const step = {
  run: async (stepId: string, stepBody: () => Promise<unknown>) => {
    helperState.stepLog.push(stepId);
    return stepBody();
  },
  sleepUntil: async (stepId: string, wakeAt: string) => {
    helperState.stepLog.push(`${stepId}:${wakeAt}`);
  },
};

function runWorker(eventData: typeof EVENT_DATA = EVENT_DATA) {
  return workerFunction.handler({ event: { data: eventData }, step });
}

function runOnFailure() {
  return workerFunction.config.onFailure({
    event: { data: { event: { data: EVENT_DATA } } },
    error: new Error("boom"),
  });
}

beforeEach(() => {
  helperState.load = { kind: "ready", post: POST };
  helperState.claim = { success: true, claimed: true };
  helperState.isPublished = false;
  helperState.claimCalls = [];
  helperState.recorded = [];
  helperState.platformCalls = 0;
  helperState.publishResult = { ok: true };
  helperState.cleanupDecisions = [];
  helperState.shouldDeleteMedia = true;
  helperState.stepLog = [];
});

describe("processSinglePost", () => {
  test("a deleted account fails the post visibly instead of leaving it queued", async () => {
    helperState.load = { kind: "account_missing", post: POST };
    await runWorker();
    expect(helperState.claimCalls).toEqual([
      { scheduledPostId: POST.id, dispatchedScheduledAt: EVENT_DATA.scheduled_at },
    ]);
    expect(helperState.recorded).toEqual([
      {
        ok: false,
        reason: "invalid_input",
        message: "Social account not found or deleted",
        mayHavePublished: false,
      },
    ]);
  });

  test("a failed post lookup throws so Inngest retries the step", async () => {
    helperState.load = { kind: "lookup_failed", message: "connection reset" };
    await expect(runWorker()).rejects.toThrow("post-lookup-failure");
  });

  test("a failed claim throws instead of reading as claimed by another worker", async () => {
    helperState.claim = { success: false, message: "claim error: timeout" };
    await expect(runWorker()).rejects.toThrow("claim error");
  });

  test("a re-executed publish step does not publish twice", async () => {
    helperState.isPublished = true;
    await runWorker();
    expect(helperState.platformCalls).toBe(0);
    expect(helperState.recorded).toEqual([{ ok: true, contentId: POST.id }]);
  });

  test("a transient refusal that published nothing throws so Inngest retries it", async () => {
    helperState.publishResult = {
      ok: false,
      reason: "transient",
      message: "token refresh failed",
      mayHavePublished: false,
    };
    await expect(runWorker()).rejects.toThrow("retryable: transient");
    expect(helperState.recorded).toEqual([]);
  });

  test("a failure that may have published is recorded, never retried", async () => {
    const mayHavePublished: PublishResult = {
      ok: false,
      reason: "transient",
      message: "publish request failed (502)",
      mayHavePublished: true,
    };
    helperState.publishResult = mayHavePublished;
    await runWorker();
    expect(helperState.platformCalls).toBe(1);
    expect(helperState.recorded).toEqual([mayHavePublished]);
  });

  test("media cleanup follows the shared decision for the published outcome", async () => {
    const postWithMedia = { ...POST, platform: "tiktok", media_storage_path: "principal-1/clip.mp4" };
    helperState.load = { kind: "ready", post: postWithMedia };
    helperState.shouldDeleteMedia = false;
    await runWorker();
    expect(helperState.cleanupDecisions).toEqual([{ platform: "tiktok", mightBeLive: true }]);
    expect(helperState.stepLog).not.toContain("cleanup-storage");

    helperState.shouldDeleteMedia = true;
    await runWorker();
    expect(helperState.stepLog).toContain("cleanup-storage");
  });

  test("a failure that may have published counts as possibly live for media cleanup, a refusal does not", async () => {
    helperState.load = {
      kind: "ready",
      post: { ...POST, platform: "reddit", media_storage_path: "principal-1/clip.mp4" },
    };
    helperState.publishResult = {
      ok: false,
      reason: "transient",
      message: "publish request failed (502)",
      mayHavePublished: true,
    };
    await runWorker();
    helperState.publishResult = {
      ok: false,
      reason: "policy_rejected",
      message: "Rejected",
      mayHavePublished: false,
    };
    await runWorker();
    expect(helperState.cleanupDecisions).toEqual([
      { platform: "reddit", mightBeLive: true },
      { platform: "reddit", mightBeLive: false },
    ]);
  });

  test("a first publish calls the platform once and records the outcome", async () => {
    await runWorker();
    expect(helperState.platformCalls).toBe(1);
    expect(helperState.recorded.map((outcome) => outcome.ok)).toEqual([true]);
    expect(helperState.stepLog.filter((stepId) => stepId.startsWith("wait-until"))).toEqual([]);
  });

  test("a run that starts before the post's time sleeps until it, then claims the row", async () => {
    const futureScheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await runWorker({ ...EVENT_DATA, scheduled_at: futureScheduledAt });
    const sleepIndex = helperState.stepLog.indexOf(`wait-until-scheduled-time:${futureScheduledAt}`);
    expect(sleepIndex).toBeGreaterThan(-1);
    expect(sleepIndex).toBeLessThan(helperState.stepLog.indexOf("claim-post"));
    expect(helperState.claimCalls).toEqual([
      { scheduledPostId: POST.id, dispatchedScheduledAt: futureScheduledAt },
    ]);
  });
});

describe("processSinglePost onFailure", () => {
  test("claims a still-queued row for its dispatched time and records it failed", async () => {
    await runOnFailure();
    expect(helperState.claimCalls).toEqual([
      { scheduledPostId: POST.id, dispatchedScheduledAt: EVENT_DATA.scheduled_at },
    ]);
    expect(helperState.recorded).toEqual([
      { ok: false, reason: "transient", message: "Retries exhausted: boom", mayHavePublished: true },
    ]);
  });

  test("records a published post as posted, not failed", async () => {
    helperState.load = { kind: "ready", post: { ...POST, status: "processing" } };
    helperState.isPublished = true;
    await runOnFailure();
    expect(helperState.claimCalls).toEqual([]);
    expect(helperState.recorded).toEqual([{ ok: true, contentId: POST.id }]);
  });

  test("leaves a row rescheduled since dispatch untouched", async () => {
    helperState.claim = { success: true, claimed: false };
    await runOnFailure();
    expect(helperState.recorded).toEqual([]);
  });
});
