import { beforeEach, describe, expect, mock, test } from "bun:test";

type Outcome =
  | { ok: true; contentId: string; mediaUrl: string | null }
  | { ok: false; reason: string; message: string };

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
};

const helperState: HelperState = {
  load: { kind: "ready", post: POST },
  claim: { success: true, claimed: true },
  isPublished: false,
  claimCalls: [],
  recorded: [],
  platformCalls: 0,
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
  buildPlatformSignedUrls: async () => ({ success: true, mediaUrl: null, tiktokMediaUrl: null }),
  callPlatformDirectPost: async (): Promise<Outcome> => {
    helperState.platformCalls += 1;
    return { ok: true, contentId: POST.id, mediaUrl: null };
  },
  recordPostStatus: async (input: { result: Outcome }) => {
    helperState.recorded.push(input.result);
    return { success: true, updated: true };
  },
  cleanupMediaIfUnreferenced: async () => ({ success: true, deleted: false }),
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
  run: async (_stepId: string, stepBody: () => Promise<unknown>) => stepBody(),
};

function runWorker() {
  return workerFunction.handler({ event: { data: EVENT_DATA }, step });
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
});

describe("processSinglePost", () => {
  test("a deleted account fails the post visibly instead of leaving it queued", async () => {
    helperState.load = { kind: "account_missing", post: POST };
    await runWorker();
    expect(helperState.claimCalls).toEqual([
      { scheduledPostId: POST.id, dispatchedScheduledAt: EVENT_DATA.scheduled_at },
    ]);
    expect(helperState.recorded).toEqual([
      { ok: false, reason: "invalid_input", message: "Social account not found or deleted" },
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
    expect(helperState.recorded).toEqual([{ ok: true, contentId: POST.id, mediaUrl: null }]);
  });

  test("a first publish calls the platform once and records the outcome", async () => {
    await runWorker();
    expect(helperState.platformCalls).toBe(1);
    expect(helperState.recorded.map((outcome) => outcome.ok)).toEqual([true]);
  });
});

describe("processSinglePost onFailure", () => {
  test("claims a still-queued row for its dispatched time and records it failed", async () => {
    await runOnFailure();
    expect(helperState.claimCalls).toEqual([
      { scheduledPostId: POST.id, dispatchedScheduledAt: EVENT_DATA.scheduled_at },
    ]);
    expect(helperState.recorded).toEqual([
      { ok: false, reason: "transient", message: "Retries exhausted: boom" },
    ]);
  });

  test("records a published post as posted, not failed", async () => {
    helperState.load = { kind: "ready", post: { ...POST, status: "processing" } };
    helperState.isPublished = true;
    await runOnFailure();
    expect(helperState.claimCalls).toEqual([]);
    expect(helperState.recorded).toEqual([{ ok: true, contentId: POST.id, mediaUrl: null }]);
  });

  test("leaves a row rescheduled since dispatch untouched", async () => {
    helperState.claim = { success: true, claimed: false };
    await runOnFailure();
    expect(helperState.recorded).toEqual([]);
  });
});
