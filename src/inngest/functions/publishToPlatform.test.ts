import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { DirectPostScheduleResult } from "@/lib/api/_shared/directPostForAccountsGeneric";
import type { RegistryPublishResult } from "@/lib/platforms/providers/publishViaRegistry";
import type { SocialAccount } from "@/lib/types/dbTypes";

type AdapterCall = { adapter: string; config: Record<string, unknown> };

const adapterState: {
  calls: AdapterCall[];
  adapterResult: DirectPostScheduleResult;
  registryResult: RegistryPublishResult;
  signedTtls: number[];
} = {
  calls: [],
  adapterResult: { success: true, count: 1, message: "posted", warnings: [] },
  registryResult: { success: true, count: 1 },
  signedTtls: [],
};

function recordAdapterCall(adapter: string) {
  return async (config: Record<string, unknown>) => {
    adapterState.calls.push({ adapter, config });
    return adapterState.adapterResult;
  };
}

mock.module("server-only", () => ({}));
mock.module("@/actions/server/data/getServerSignedViewUrl", () => ({
  getServerSignedViewUrl: async (path: string, ttlS: number) => {
    adapterState.signedTtls.push(ttlS);
    return { success: true, url: `https://signed.example/${path}` };
  },
}));
mock.module("@/lib/api/tiktok/buildTikTokMediaUrl", () => ({
  buildTikTokMediaUrl: async (input: { mediaPath: string }) => ({
    success: true,
    url: `https://proxy.example/${input.mediaPath}`,
    mode: "proxy",
  }),
}));
mock.module("@/lib/api/facebook/post/directPostForFacebookAccounts", () => ({
  directPostForFacebookAccounts: recordAdapterCall("facebook"),
}));
mock.module("@/lib/api/instagram/post/directPostForInstagramAccounts", () => ({
  directPostForInstagramAccounts: recordAdapterCall("instagram"),
}));
mock.module("@/lib/api/linkedin/post/directPostForLinkedInAccounts", () => ({
  directPostForLinkedInAccounts: recordAdapterCall("linkedin"),
}));
mock.module("@/lib/api/pinterest/post/directPostForPinterestAccounts", () => ({
  directPostForPinterestAccounts: recordAdapterCall("pinterest"),
}));
mock.module("@/lib/api/tiktok/post/directPostForTikTokAccounts", () => ({
  directPostForTikTokAccounts: recordAdapterCall("tiktok"),
}));
mock.module("@/lib/api/x/post/directPostForXAccounts", () => ({
  directPostForXAccounts: recordAdapterCall("x"),
}));
mock.module("@/lib/api/youtube/post/directPostForYouTubeAccounts", () => ({
  directPostForYouTubeAccounts: recordAdapterCall("youtube"),
}));
mock.module("@/lib/platforms/providers/publishViaRegistry", () => ({
  publishViaRegistry: async (config: Record<string, unknown>) => {
    adapterState.calls.push({ adapter: "registry", config });
    return adapterState.registryResult;
  },
}));

const {
  DEFAULT_COVER_TIMESTAMP_MS,
  HOTLINK_SIGNED_URL_TTL_S,
  mintPublishMediaUrls,
  publishToPlatform,
  shouldDeleteMediaAfterPublish,
} = await import("./publishToPlatform");
const { isSafeToRetryPost } = await import("./platformErrors");
const { RUNTIME } = await import("@/lib/jobs/runtimeConfig");

type PublishRequest = Parameters<typeof publishToPlatform>[0];

const ACCOUNT: SocialAccount = {
  id: "account-1",
  principal_id: "principal-1",
  platform: "linkedin",
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

function buildRequest(overrides: Partial<PublishRequest>): PublishRequest {
  return {
    account: ACCOUNT,
    principalId: "principal-1",
    platform: "linkedin",
    postType: "video",
    title: "Title",
    description: "Caption",
    link: "",
    platformOptions: {},
    pinterestBoard: null,
    registryOptions: {},
    coverTimestampMs: null,
    media: {
      storagePath: "principal-1/clip.mp4",
      urls: { publicUrl: "https://signed.example/clip", tiktokUrl: "https://proxy.example/clip" },
    },
    batchId: "batch-1",
    scheduledPostId: null,
    createdVia: "web",
    ...overrides,
  };
}

function readOnlyCall(): AdapterCall {
  expect(adapterState.calls).toHaveLength(1);
  return adapterState.calls[0];
}

beforeEach(() => {
  adapterState.calls = [];
  adapterState.adapterResult = { success: true, count: 1, message: "posted", warnings: [] };
  adapterState.registryResult = { success: true, count: 1 };
  adapterState.signedTtls = [];
});

describe("publishToPlatform", () => {
  test("LinkedIn gets no cover timestamp, file name or cron flag", async () => {
    await publishToPlatform(buildRequest({ platform: "linkedin" }));
    const { adapter, config } = readOnlyCall();
    expect(adapter).toBe("linkedin");
    expect(Object.keys(config)).not.toContain("coverTimestamp");
    expect(Object.keys(config)).not.toContain("fileName");
    expect(Object.keys(config)).not.toContain("isCronJob");
    expect(config.mediaType).toBe("video/mp4");
  });

  test.each(["tiktok", "pinterest", "instagram"])(
    "%s gets the named default cover timestamp when the post has none",
    async (platform) => {
      await publishToPlatform(
        buildRequest({ platform, pinterestBoard: { boardId: "board-1", boardName: null } }),
      );
      expect(readOnlyCall().config.coverTimestamp).toBe(DEFAULT_COVER_TIMESTAMP_MS);
    },
  );

  test("a Pinterest post without a board is refused before any platform call", async () => {
    const result = await publishToPlatform(buildRequest({ platform: "pinterest" }));
    expect(result).toEqual({
      ok: false,
      reason: "invalid_input",
      message: "No board configured for Pinterest post",
      mayHavePublished: false,
    });
    expect(adapterState.calls).toEqual([]);
  });

  test("an adapter's typed failure passes through, and only a refusal that published nothing is retried", async () => {
    adapterState.adapterResult = {
      success: false,
      count: 0,
      message: "Token refresh failed",
      failure: { reason: "transient", mayHavePublished: false },
    };
    const refusedBeforePublish = await publishToPlatform(buildRequest({}));
    expect(refusedBeforePublish).toEqual({
      ok: false,
      reason: "transient",
      message: "Token refresh failed",
      mayHavePublished: false,
    });
    if (refusedBeforePublish.ok) throw new Error("expected a failure");
    expect(isSafeToRetryPost(refusedBeforePublish)).toBe(true);

    adapterState.adapterResult = {
      success: false,
      count: 0,
      message: "Publish request failed (502)",
      failure: { reason: "transient", mayHavePublished: true },
    };
    const maybePublished = await publishToPlatform(buildRequest({}));
    if (maybePublished.ok) throw new Error("expected a failure");
    expect(isSafeToRetryPost(maybePublished)).toBe(false);

    adapterState.adapterResult = {
      success: false,
      count: 0,
      message: "Policy",
      failure: { reason: "policy_rejected", mayHavePublished: false },
    };
    const rejected = await publishToPlatform(buildRequest({}));
    if (rejected.ok) throw new Error("expected a failure");
    expect(isSafeToRetryPost(rejected)).toBe(false);
  });

  test("registry failures keep the text classifier, so only a rate limit is retried", async () => {
    adapterState.registryResult = { success: false, count: 0, message: "Too many requests" };
    const rateLimited = await publishToPlatform(buildRequest({ platform: "bluesky", postType: "text" }));
    if (rateLimited.ok) throw new Error("expected a failure");
    expect(rateLimited.reason).toBe("rate_limited");
    expect(isSafeToRetryPost(rateLimited)).toBe(true);

    adapterState.registryResult = { success: false, count: 0, message: "Request timeout" };
    const timedOut = await publishToPlatform(buildRequest({ platform: "bluesky", postType: "text" }));
    if (timedOut.ok) throw new Error("expected a failure");
    expect(timedOut.reason).toBe("transient");
    expect(isSafeToRetryPost(timedOut)).toBe(false);
  });
});

describe("mintPublishMediaUrls", () => {
  const storagePath = "principal-1/photo.jpg";

  test("mints one URL kind per platform, with the TTL decided by whether the platform hotlinks", async () => {
    const mint = (platform: string) =>
      mintPublishMediaUrls({ platform, storagePath, principalId: "principal-1" });

    expect(await mint("linkedin")).toEqual({ success: true, publicUrl: null, tiktokUrl: null });
    expect(await mint("tiktok")).toEqual({
      success: true,
      publicUrl: null,
      tiktokUrl: `https://proxy.example/${storagePath}`,
    });
    expect(await mint("instagram")).toEqual({
      success: true,
      publicUrl: `https://signed.example/${storagePath}`,
      tiktokUrl: null,
    });
    await mint("reddit");
    expect(adapterState.signedTtls).toEqual([RUNTIME.signedUrlTtlS, HOTLINK_SIGNED_URL_TTL_S]);
  });

  test("a text post mints nothing", async () => {
    expect(
      await mintPublishMediaUrls({ platform: "instagram", storagePath: "", principalId: "principal-1" }),
    ).toEqual({ success: true, publicUrl: null, tiktokUrl: null });
    expect(adapterState.signedTtls).toEqual([]);
  });
});

describe("shouldDeleteMediaAfterPublish", () => {
  test("keeps media TikTok still has to pull or a hotlinking platform serves, deletes it otherwise", () => {
    expect(shouldDeleteMediaAfterPublish({ platform: "tiktok", isPublished: true })).toBe(false);
    expect(shouldDeleteMediaAfterPublish({ platform: "reddit", isPublished: true })).toBe(false);
    expect(shouldDeleteMediaAfterPublish({ platform: "instagram", isPublished: true })).toBe(true);
    expect(shouldDeleteMediaAfterPublish({ platform: "tiktok", isPublished: false })).toBe(true);
    expect(shouldDeleteMediaAfterPublish({ platform: "reddit", isPublished: false })).toBe(true);
  });
});
