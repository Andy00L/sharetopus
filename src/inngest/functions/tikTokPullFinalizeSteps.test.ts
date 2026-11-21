import { beforeEach, describe, expect, mock, test } from "bun:test";

import { createFakePostgres, type FakeRow } from "./fakePostgres";

type SentWebhook = { principalId: string; eventType: string; payload: Record<string, unknown> };

const PUBLISH_ID = "v_pub_url~123";
const MEDIA_PATH = "principal-1/video.mp4";
const TIKTOK_REJECTION = { outcome: "failed", reason: "policy_rejected", message: "spam_risk_text" } as const;

const fakePostgres = createFakePostgres();
const sentWebhooks: SentWebhook[] = [];

process.env.DATABASE_URL = "postgres://fake:fake@localhost:5432/fake";

mock.module("server-only", () => ({}));

mock.module("postgres", () => ({ default: () => fakePostgres.client }));

mock.module("./processSinglePostHelpers", () => ({
  cleanupMediaIfUnreferenced: async () => ({ success: true, message: "cleanup done", deleted: true }),
}));

mock.module("@/lib/api/rest/webhooks/dispatch", () => ({
  dispatchWebhook: async (principalId: string, eventType: string, payload: Record<string, unknown>) => {
    sentWebhooks.push({ principalId, eventType, payload });
  },
}));

const finalizeStepsModule: Record<string, unknown> = await import("./tikTokPullFinalizeSteps");

function readFinalizeInSteps(): (input: unknown) => Promise<unknown> {
  const finalizeInSteps = finalizeStepsModule.finalizeTikTokPullInSteps;
  if (typeof finalizeInSteps !== "function") throw new Error("finalizeTikTokPullInSteps not exported");
  return (input: unknown) => Promise.resolve(finalizeInSteps(input));
}

const finalizeInSteps = readFinalizeInSteps();

const step = {
  run: async (_stepId: string, stepBody: () => Promise<unknown>) => stepBody(),
};

function finalizePull(result: unknown) {
  return finalizeInSteps({ step, stepId: "finalize-failed", publishId: PUBLISH_ID, source: "poll", result });
}

function buildPull(changes: Partial<FakeRow>): FakeRow {
  return {
    publish_id: PUBLISH_ID,
    principal_id: "principal-1",
    social_account_id: "account-1",
    scheduled_post_id: null,
    content_history_id: "history-1",
    media_storage_path: MEDIA_PATH,
    status: "pending",
    attempt_count: 0,
    last_polled_at: null,
    finalized_at: null,
    failure_reason: null,
    created_at: "2026-11-21T10:00:05.000Z",
    tiktok_post_id: null,
    creator_username: "creator",
    ...changes,
  };
}

function buildDispatch(changes: Partial<FakeRow>): FakeRow {
  return {
    event_id: "dispatch-1",
    batch_id: "batch-1",
    principal_id: "principal-1",
    social_account_id: "account-1",
    platform: "tiktok",
    media_storage_path: MEDIA_PATH,
    status: "completed",
    failure_reason: null,
    created_at: "2026-11-21T10:00:00.000Z",
    finished_at: "2026-11-21T10:00:06.000Z",
    idempotency_key: null,
    publish_started_at: "2026-11-21T10:00:01.000Z",
    ...changes,
  };
}

function readDispatch(dispatchId: string): FakeRow | undefined {
  return fakePostgres.tables.get("pending_direct_posts")?.find((row) => row.event_id === dispatchId);
}

const DISPATCH_FAILED_WEBHOOK: SentWebhook = {
  principalId: "principal-1",
  eventType: "post.failed",
  payload: {
    dispatch_id: "dispatch-1",
    batch_id: "batch-1",
    platform: "tiktok",
    social_account_id: "account-1",
    reason: "policy_rejected",
    error_message: "spam_risk_text",
    may_have_published: false,
  },
};

beforeEach(() => {
  fakePostgres.tables.set("pending_tiktok_pulls", [buildPull({})]);
  fakePostgres.tables.set("content_history", [
    { id: "history-1", batch_id: "batch-1", status: "posted", scheduled_post_id: null },
  ]);
  fakePostgres.tables.set("pending_direct_posts", [buildDispatch({})]);
  fakePostgres.tables.set("scheduled_posts", []);
  fakePostgres.faults.length = 0;
  sentWebhooks.length = 0;
});

describe("finalizeTikTokPullInSteps for a post-now dispatch", () => {
  test("a TikTok rejection after content/init fails the completed dispatch and fires post.failed with its ids", async () => {
    await finalizePull(TIKTOK_REJECTION);
    expect(readDispatch("dispatch-1")?.status).toBe("failed");
    expect(readDispatch("dispatch-1")?.failure_reason).toBe("spam_risk_text");
    expect(sentWebhooks).toEqual([DISPATCH_FAILED_WEBHOOK]);
  });

  test("a rejection that arrives before the run recorded its dispatch fails it too", async () => {
    fakePostgres.tables.set("pending_direct_posts", [buildDispatch({ status: "processing", finished_at: null })]);
    await finalizePull(TIKTOK_REJECTION);
    expect(readDispatch("dispatch-1")?.status).toBe("failed");
    expect(sentWebhooks).toEqual([DISPATCH_FAILED_WEBHOOK]);
  });

  test("the same rejection from the poll and from TikTok's webhook fires post.failed once", async () => {
    await finalizePull(TIKTOK_REJECTION);
    await finalizePull(TIKTOK_REJECTION);
    expect(sentWebhooks).toEqual([DISPATCH_FAILED_WEBHOOK]);
  });

  test("a dispatch already recorded failed keeps its record and fires nothing", async () => {
    fakePostgres.tables.set("pending_direct_posts", [
      buildDispatch({ status: "failed", failure_reason: "Publishing stopped without a result; the post may have published" }),
    ]);
    await finalizePull(TIKTOK_REJECTION);
    expect(readDispatch("dispatch-1")?.failure_reason).toBe(
      "Publishing stopped without a result; the post may have published",
    );
    expect(sentWebhooks).toEqual([]);
  });

  test("a TikTok success leaves the dispatch as recorded and fires nothing, as for a scheduled post", async () => {
    fakePostgres.tables.set("pending_direct_posts", [buildDispatch({ status: "failed", failure_reason: "unclear" })]);
    await finalizePull({ outcome: "completed", tiktokPostId: "7300000000000000000" });
    expect(readDispatch("dispatch-1")?.status).toBe("failed");
    expect(sentWebhooks).toEqual([]);
  });

  test("a pull that two dispatches could match changes neither and fires nothing", async () => {
    fakePostgres.tables.set("pending_direct_posts", [
      buildDispatch({}),
      buildDispatch({ event_id: "dispatch-2" }),
    ]);
    await finalizePull(TIKTOK_REJECTION);
    expect(readDispatch("dispatch-1")?.status).toBe("completed");
    expect(readDispatch("dispatch-2")?.status).toBe("completed");
    expect(sentWebhooks).toEqual([]);
  });

  test("a failed dispatch write rolls the whole finalize back, so the retry fires post.failed once", async () => {
    fakePostgres.faults.push({ statementPrefix: 'update "pending_direct_posts"', message: "connection reset" });
    await expect(finalizePull(TIKTOK_REJECTION)).rejects.toThrow("connection reset");
    expect(fakePostgres.tables.get("pending_tiktok_pulls")?.[0]?.status).toBe("pending");
    expect(readDispatch("dispatch-1")?.status).toBe("completed");
    await finalizePull(TIKTOK_REJECTION);
    expect(sentWebhooks).toEqual([DISPATCH_FAILED_WEBHOOK]);
  });
});
