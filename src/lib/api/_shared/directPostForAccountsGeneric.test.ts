import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { PlatformPostFailure } from "@/lib/api/_shared/platformFailure";
import type { SocialAccount } from "@/lib/types/dbTypes";

type TokenResult =
  | { success: true; token: string }
  | { success: false; error: string; failureReason: "auth_expired" | "transient" | "unknown" };

type HistoryResult = { success: boolean; message: string; recordId?: string };

let resolveToken: () => Promise<TokenResult> = async () => ({ success: true, token: "token-1" });
let storeHistory: () => Promise<HistoryResult> = async () => ({
  success: true,
  message: "stored",
  recordId: "history-1",
});

mock.module("server-only", () => ({}));
mock.module("@/lib/api/ensureValidToken", () => ({
  ensureValidToken: () => resolveToken(),
}));
mock.module("@/actions/server/contentHistoryActions/storeContentHistory", () => ({
  storeContentHistory: () => storeHistory(),
}));

const { directPostForAccountsGeneric } = await import("./directPostForAccountsGeneric");

type TestPassthrough = { mediaLabel: string };
type TestPostResult = { success: true; postId: string } | PlatformPostFailure;

const ACCOUNT: SocialAccount = {
  id: "account-1",
  principal_id: "principal-1",
  platform: "x",
  account_identifier: "identifier-1",
  display_name: "Account One",
  username: "account_one",
  email_address: null,
  avatar_url: null,
  is_verified: null,
  follower_count: null,
  following_count: null,
  bio_description: null,
  is_available: true,
  access_token: "stored-token",
  refresh_token: null,
  token_expires_at: null,
  connection_id: null,
  extra: {},
  created_at: "2026-11-20T00:00:00.000Z",
  updated_at: "2026-11-20T00:00:00.000Z",
  deleted_at: null,
};

const CONFIG = {
  platform: "x",
  logPrefix: "[directPostForAccountsGeneric.test]",
  account: ACCOUNT,
  accountContent: { accountId: ACCOUNT.id, description: "caption" },
  userId: "principal-1",
  batchId: "batch-1",
  scheduledPostId: null,
  postType: "text",
  createdVia: "web",
} as const;

let platformCallCount = 0;

function buildAdapter(overrides: {
  preparePassthrough?: (passthrough: TestPassthrough) => Promise<{ success: true; passthrough: TestPassthrough }>;
  call?: () => Promise<TestPostResult>;
}) {
  return {
    preparePassthrough: overrides.preparePassthrough,
    call: async () => {
      platformCallCount += 1;
      return overrides.call ? overrides.call() : { success: true as const, postId: "post-1" };
    },
    toHistoryFields: (postResult: { postId: string }) => ({
      content_id: postResult.postId,
      media_url: null,
      status: "posted",
      extra: {},
    }),
  };
}

beforeEach(() => {
  platformCallCount = 0;
  resolveToken = async () => ({ success: true, token: "token-1" });
  storeHistory = async () => ({ success: true, message: "stored", recordId: "history-1" });
});

describe("a throw before the platform request publishes nothing", () => {
  test("a media download that throws leaves the post safe to retry", async () => {
    const result = await directPostForAccountsGeneric<TestPassthrough, TestPostResult>(
      CONFIG,
      { mediaLabel: "video" },
      buildAdapter({
        preparePassthrough: async () => {
          throw new Error("storage socket hang up");
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.failure).toEqual({ reason: "transient", mayHavePublished: false });
    expect(platformCallCount).toBe(0);
  });

  test("a token refresh that throws leaves the post safe to retry", async () => {
    resolveToken = async () => {
      throw new Error("redis unreachable");
    };

    const result = await directPostForAccountsGeneric<TestPassthrough, TestPostResult>(
      CONFIG,
      { mediaLabel: "video" },
      buildAdapter({}),
    );

    expect(result.failure).toEqual({ reason: "transient", mayHavePublished: false });
    expect(platformCallCount).toBe(0);
  });
});

describe("a throw once the platform request started", () => {
  test("is reported as possibly published, so no automatic retry repeats the post", async () => {
    const result = await directPostForAccountsGeneric<TestPassthrough, TestPostResult>(
      CONFIG,
      { mediaLabel: "video" },
      buildAdapter({
        call: async () => {
          throw new Error("socket closed mid-answer");
        },
      }),
    );

    expect(result.failure).toEqual({ reason: "unknown", mayHavePublished: true });
    expect(platformCallCount).toBe(1);
  });
});

describe("bookkeeping after the platform accepted the post", () => {
  test("a content history write that throws keeps the post a success, with a warning", async () => {
    storeHistory = async () => {
      throw new Error("pooler connection lost");
    };

    const result = await directPostForAccountsGeneric<TestPassthrough, TestPostResult>(
      CONFIG,
      { mediaLabel: "video" },
      buildAdapter({}),
    );

    expect(result).toEqual({
      success: true,
      count: 1,
      message: "Successfully posted to Account One",
      warnings: [{ kind: "content_history_not_recorded", message: "pooler connection lost" }],
    });
  });
});
