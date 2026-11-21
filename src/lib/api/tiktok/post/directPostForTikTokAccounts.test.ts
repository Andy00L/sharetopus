import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { PostOrigin } from "@/lib/platforms/providers/publishViaRegistry";
import type { SocialAccount } from "@/lib/types/dbTypes";

type SentEvent = { id?: string; name: string; data: Record<string, unknown> };

const PUBLISH_ID = "v_pub_url~v2-1.7400000000000000000";

let pullInsertResult: { success: true } | { success: false; message: string } = { success: true };
const sentEvents: SentEvent[] = [];
const insertedPulls: Record<string, unknown>[] = [];

mock.module("server-only", () => ({}));
mock.module("@/lib/api/ensureValidToken", () => ({
  ensureValidToken: async () => ({ success: true, token: "token-1" }),
}));
mock.module("@/actions/server/contentHistoryActions/storeContentHistory", () => ({
  storeContentHistory: async () => ({ success: true, message: "stored", recordId: "history-1" }),
}));
mock.module("@/actions/server/data/pendingTikTokPulls", () => ({
  insertPendingTikTokPull: async (pull: Record<string, unknown>) => {
    insertedPulls.push(pull);
    return pullInsertResult;
  },
}));
mock.module("@/inngest/client", () => ({
  inngest: {
    send: async (event: SentEvent) => {
      sentEvents.push(event);
      return { ids: [event.id ?? "generated"] };
    },
  },
}));
mock.module("@/lib/api/tiktok/post/postToTikTok", () => ({
  postToTikTok: async () => ({
    success: true,
    publishId: PUBLISH_ID,
    postUrl: "https://www.tiktok.com/@creator",
    data: {},
    message: "Post started",
    status: "processing",
    content_id: PUBLISH_ID,
    creator_username: "creator",
  }),
}));

const { directPostForTikTokAccounts } = await import("./directPostForTikTokAccounts");

const ACCOUNT: SocialAccount = {
  id: "account-1",
  principal_id: "principal-1",
  platform: "tiktok",
  account_identifier: "open-id-1",
  display_name: "Creator",
  username: "creator",
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

function postToTikTokNow(origin: PostOrigin = { kind: "post_now", dispatchId: "dispatch-1" }) {
  return directPostForTikTokAccounts({
    account: ACCOUNT,
    mediaPath: "principal-1/video.mp4",
    coverTimestamp: 0,
    tiktokMediaUrl: "https://media.example.com/video.mp4",
    mediaType: "video/mp4",
    platformOptions: {},
    accountContent: {
      accountId: ACCOUNT.id,
      title: "",
      description: "caption",
      isCustomized: false,
    },
    userId: "principal-1",
    postType: "video",
    fileName: "video.mp4",
    batchId: "batch-1",
    origin,
    createdVia: "web",
  });
}

beforeEach(() => {
  pullInsertResult = { success: true };
  sentEvents.length = 0;
  insertedPulls.length = 0;
});

describe("directPostForTikTokAccounts after TikTok accepted the post", () => {
  test("the poll event carries an id derived from publish_id, so a repeated send starts no second poller", async () => {
    const result = await postToTikTokNow();

    expect(result).toMatchObject({ success: true, warnings: [] });
    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0]).toMatchObject({
      id: `tiktok-poll-${PUBLISH_ID}`,
      name: "tiktok.publish.poll",
    });
    expect(sentEvents[0].data).toEqual({ publish_id: PUBLISH_ID, social_account_id: ACCOUNT.id });
  });

  test("a pull row that could not be saved is a warning on a successful post, and no poll starts", async () => {
    pullInsertResult = { success: false, message: "Insert failed: connection reset" };

    const result = await postToTikTokNow();

    expect(result).toEqual({
      success: true,
      count: 1,
      message: "Successfully posted to Creator",
      warnings: [{ kind: "tiktok_pull_not_recorded", message: "Insert failed: connection reset" }],
    });
    expect(sentEvents).toHaveLength(0);
  });

  test("a post-now pull names its dispatch and no scheduled post", async () => {
    await postToTikTokNow({ kind: "post_now", dispatchId: "dispatch-1" });

    expect(insertedPulls).toHaveLength(1);
    expect(insertedPulls[0]).toMatchObject({ dispatch_id: "dispatch-1", scheduled_post_id: null });
  });

  test("a scheduled post's pull names the scheduled post and no dispatch", async () => {
    await postToTikTokNow({ kind: "scheduled", scheduledPostId: "post-3" });

    expect(insertedPulls).toHaveLength(1);
    expect(insertedPulls[0]).toMatchObject({ dispatch_id: null, scheduled_post_id: "post-3" });
  });
});
