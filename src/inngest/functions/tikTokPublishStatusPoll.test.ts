import { beforeEach, describe, expect, mock, test } from "bun:test";

type PullLookup =
  | { success: true; pull: { status: "pending" | "completed" | "failed" } }
  | { success: false; reason: "not_found" | "lookup_failed"; message: string };

type PublishStatus =
  | {
      success: true;
      terminal: boolean;
      kind: "completed" | "failed" | "in_progress";
      raw_status: string;
      reason?: string;
      tiktok_post_id?: string;
    }
  | { success: false; message: string };

type FinalizeResult =
  | { success: true; kind: "not_found" | "already_finalized" }
  | {
      success: true;
      kind: "finalized";
      principalId: string;
      mediaStoragePath: string;
      failedPost: { kind: "scheduled"; scheduledPostId: string; reason: string; message: string } | null;
    }
  | { success: false; message: string };

type FinalizeCall = { publishId: string; source: string; result: unknown };
type WebhookCall = { principalId: string; eventType: string; payload: Record<string, unknown> };

const PUBLISH_ID = "v_pub_url~123";

const FINALIZED_FAILURE: FinalizeResult = {
  success: true,
  kind: "finalized",
  principalId: "principal-1",
  mediaStoragePath: "principal-1/video.mp4",
  failedPost: {
    kind: "scheduled",
    scheduledPostId: "scheduled-1",
    reason: "policy_rejected",
    message: "spam_risk_text",
  },
};

const pollState: {
  lookup: PullLookup;
  status: PublishStatus;
  finalize: FinalizeResult;
  finalizeCalls: FinalizeCall[];
  cleanupCalls: string[];
  webhookCalls: WebhookCall[];
  stepIds: string[];
} = {
  lookup: { success: true, pull: { status: "pending" } },
  status: { success: true, terminal: false, kind: "in_progress", raw_status: "PROCESSING_DOWNLOAD" },
  finalize: FINALIZED_FAILURE,
  finalizeCalls: [],
  cleanupCalls: [],
  webhookCalls: [],
  stepIds: [],
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

mock.module("@/actions/server/data/pendingTikTokPulls", () => ({
  findPendingTikTokPullByPublishId: async () => pollState.lookup,
  incrementTikTokPullAttemptCount: async () => ({ success: true, message: "Attempt count: 1" }),
}));

mock.module("@/actions/server/data/finalizeTikTokPostByPublishId", () => ({
  finalizeTikTokPostByPublishId: async (input: FinalizeCall) => {
    pollState.finalizeCalls.push(input);
    return pollState.finalize;
  },
}));

mock.module("./tikTokPublishStatusPollHelpers", () => ({
  resolveTikTokAccessTokenForAccount: async () => ({ success: true, token: "token" }),
}));

mock.module("@/lib/api/tiktok/getTikTokPublishStatus", () => ({
  getTikTokPublishStatus: async () => pollState.status,
}));

mock.module("./processSinglePostHelpers", () => ({
  cleanupMediaIfUnreferenced: async (mediaPath: string) => {
    pollState.cleanupCalls.push(mediaPath);
    return { success: true, message: "cleanup done", deleted: true };
  },
}));

mock.module("@/lib/api/rest/webhooks/dispatch", () => ({
  dispatchWebhook: async (
    principalId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ) => {
    pollState.webhookCalls.push({ principalId, eventType, payload });
  },
}));

const { tikTokPublishStatusPollWorker } = await import("./tikTokPublishStatusPoll");
const { processTikTokPublishWebhook } = await import("./processTikTokPublishWebhook");

type CapturedFunction = { handler: (input: unknown) => Promise<unknown> };

function readCapturedFunction(candidate: unknown): CapturedFunction {
  if (typeof candidate !== "object" || candidate === null || !("handler" in candidate)) {
    throw new Error("createFunction mock not applied");
  }
  const handler: unknown = candidate.handler;
  if (typeof handler !== "function") throw new Error("captured handler is not a function");
  return { handler: (input: unknown) => Promise.resolve(handler(input)) };
}

const pollWorker = readCapturedFunction(tikTokPublishStatusPollWorker);
const webhookWorker = readCapturedFunction(processTikTokPublishWebhook);

const step = {
  run: async (stepId: string, stepBody: () => Promise<unknown>) => {
    pollState.stepIds.push(stepId);
    return stepBody();
  },
  sleep: async () => undefined,
};

function runPoll() {
  return pollWorker.handler({
    event: { data: { publish_id: PUBLISH_ID, social_account_id: "account-1" } },
    step,
  });
}

beforeEach(() => {
  pollState.lookup = { success: true, pull: { status: "pending" } };
  pollState.status = { success: true, terminal: false, kind: "in_progress", raw_status: "PROCESSING_DOWNLOAD" };
  pollState.finalize = FINALIZED_FAILURE;
  pollState.finalizeCalls = [];
  pollState.cleanupCalls = [];
  pollState.webhookCalls = [];
  pollState.stepIds = [];
});

describe("tikTokPublishStatusPollWorker", () => {
  test("a pull row that no longer exists ends the poll without a failed run", async () => {
    pollState.lookup = { success: false, reason: "not_found", message: "No pending pull" };
    expect(await runPoll()).toEqual({ outcome: "skipped", reason: "pull_not_found" });
    expect(pollState.finalizeCalls).toEqual([]);
  });

  test("a failed pull lookup throws inside its step so Inngest retries it", async () => {
    pollState.lookup = { success: false, reason: "lookup_failed", message: "Query failed: timeout" };
    await expect(runPoll()).rejects.toThrow("Query failed: timeout");
    expect(pollState.finalizeCalls).toEqual([]);
  });

  test("a TikTok rejection fails the pull with its class, then cleans the media and fires post.failed", async () => {
    pollState.status = {
      success: true,
      terminal: true,
      kind: "failed",
      raw_status: "FAILED",
      reason: "spam_risk_text",
    };
    await runPoll();
    expect(pollState.finalizeCalls).toEqual([
      {
        publishId: PUBLISH_ID,
        source: "poll",
        result: { outcome: "failed", reason: "policy_rejected", message: "spam_risk_text" },
      },
    ]);
    expect(pollState.cleanupCalls).toEqual(["principal-1/video.mp4"]);
    expect(pollState.webhookCalls).toEqual([
      {
        principalId: "principal-1",
        eventType: "post.failed",
        payload: {
          post_id: "scheduled-1",
          platform: "tiktok",
          reason: "policy_rejected",
          error_message: "spam_risk_text",
          may_have_published: false,
        },
      },
    ]);
    expect(pollState.stepIds.slice(-3)).toEqual([
      "finalize-failed",
      "finalize-failed-cleanup-media",
      "finalize-failed-notify-post-failed",
    ]);
  });

  test("a pull another caller already finalized gets no second cleanup or notification", async () => {
    pollState.status = { success: true, terminal: true, kind: "completed", raw_status: "PUBLISH_COMPLETE" };
    pollState.finalize = { success: true, kind: "already_finalized" };
    await runPoll();
    expect(pollState.cleanupCalls).toEqual([]);
    expect(pollState.webhookCalls).toEqual([]);
  });

  test("a finalize that rolled back throws inside its step and runs no side effect", async () => {
    pollState.status = { success: true, terminal: true, kind: "completed", raw_status: "PUBLISH_COMPLETE" };
    pollState.finalize = { success: false, message: "Finalize failed: connection reset" };
    await expect(runPoll()).rejects.toThrow("Finalize failed: connection reset");
    expect(pollState.cleanupCalls).toEqual([]);
  });
});

describe("processTikTokPublishWebhook", () => {
  test("post.publish.failed finalizes through the same steps with the classified reason", async () => {
    pollState.finalize = { ...FINALIZED_FAILURE, failedPost: null };
    await webhookWorker.handler({
      event: {
        data: {
          event: "post.publish.failed",
          content: JSON.stringify({ publish_id: PUBLISH_ID, reason: "file_format_check_failed" }),
        },
      },
      step,
    });
    expect(pollState.finalizeCalls).toEqual([
      {
        publishId: PUBLISH_ID,
        source: "webhook",
        result: { outcome: "failed", reason: "invalid_input", message: "file_format_check_failed" },
      },
    ]);
    expect(pollState.stepIds).toEqual(["finalize-pull", "finalize-pull-cleanup-media"]);
    expect(pollState.webhookCalls).toEqual([]);
  });
});
