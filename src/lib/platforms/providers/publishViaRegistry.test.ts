import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { StoredCredential } from "@/lib/api/refreshWithAccountLock";
import type { SocialAccount } from "@/lib/types/dbTypes";

import type {
  ProviderDefinition,
  ProviderPublishInput,
  ProviderRefreshResult,
} from "./types";
import {
  buildSignedStorageUrlFixture,
  FIXTURE_STORAGE_BASE_URL,
} from "./_shared/signedStorageUrlFixture";

mock.module("server-only", () => ({}));

function buildChainableQuery(): object {
  const chainableQuery: object = new Proxy(() => chainableQuery, {
    get: () => () => chainableQuery,
    apply: () => chainableQuery,
  });
  return chainableQuery;
}

let failingWriteCount = 0;
let writeCount = 0;
mock.module("@/db/client", () => ({
  db: buildChainableQuery(),
  runQuery: async () => {
    writeCount += 1;
    if (writeCount <= failingWriteCount) {
      return { data: null, error: { message: "connection reset", code: null } };
    }
    return { data: [], error: null };
  },
}));

const storedHistoryRows: unknown[] = [];
mock.module("@/actions/server/contentHistoryActions/storeContentHistory", () => ({
  storeContentHistory: async (historyRow: unknown) => {
    storedHistoryRows.push(historyRow);
    return { success: true };
  },
}));

const STORED_CREDENTIAL: StoredCredential = {
  access_token: "old-access",
  refresh_token: "old-refresh",
  token_expires_at: "2026-11-20T00:00:00.000Z",
};

const realLock = await import("@/lib/api/refreshWithAccountLock");
mock.module("@/lib/api/refreshWithAccountLock", () => ({
  ...realLock,
  refreshWithAccountLock: async (
    _accountId: string,
    refreshStoredCredential: (stored: StoredCredential) => Promise<unknown>,
  ) => ({ kind: "refreshed", value: await refreshStoredCredential(STORED_CREDENTIAL) }),
}));

const publishedInputs: ProviderPublishInput[] = [];
let refreshAnswer: ProviderRefreshResult = {
  ok: true,
  accessToken: "new-access",
  rotatedRefreshToken: "new-refresh",
  expiresIn: 3600,
};
const realRegistry = await import("./registry");
mock.module("./registry", () => ({
  ...realRegistry,
  resolveConfiguredProvider: () => {
    const bluesky = realRegistry.getProvider("bluesky");
    if (!bluesky) throw new Error("bluesky is not registered");
    const provider: ProviderDefinition = {
      ...bluesky,
      refresh: async () => refreshAnswer,
      publish: async (publishInput) => {
        publishedInputs.push(publishInput);
        return { ok: true, postId: "at://post/1", postUrl: null };
      },
    };
    return { ok: true, provider };
  },
}));

const { publishViaRegistry, refreshRegistryAccountToken } = await import("./publishViaRegistry");

const EXPIRED_ACCOUNT: SocialAccount = {
  id: "account-1",
  principal_id: "principal-1",
  platform: "bluesky",
  account_identifier: "did:plc:abc",
  display_name: null,
  username: null,
  email_address: null,
  avatar_url: null,
  is_verified: null,
  follower_count: null,
  following_count: null,
  bio_description: null,
  is_available: true,
  connection_id: null,
  extra: { service: "https://bsky.social", did: "did:plc:abc" },
  created_at: "2026-11-20T00:00:00.000Z",
  updated_at: "2026-11-20T00:00:00.000Z",
  deleted_at: null,
  ...STORED_CREDENTIAL,
};

beforeEach(() => {
  failingWriteCount = 0;
  writeCount = 0;
  refreshAnswer = {
    ok: true,
    accessToken: "new-access",
    rotatedRefreshToken: "new-refresh",
    expiresIn: 3600,
  };
});

describe("refreshRegistryAccountToken", () => {
  test("a saved refresh returns the new token without a warning", async () => {
    const tokenResult = await refreshRegistryAccountToken(EXPIRED_ACCOUNT);
    expect(tokenResult).toEqual({
      success: true,
      accessToken: "new-access",
      reconnectWarning: null,
    });
    expect(writeCount).toBe(1);
  });

  test("a rotated refresh token that cannot be saved is retried once, then reported", async () => {
    failingWriteCount = 2;
    const tokenResult = await refreshRegistryAccountToken(EXPIRED_ACCOUNT);
    expect(writeCount).toBe(2);
    expect(tokenResult.success).toBe(true);
    if (!tokenResult.success) return;
    expect(tokenResult.accessToken).toBe("new-access");
    expect(tokenResult.reconnectWarning).toContain("reconnect");
  });

  test("a second write that succeeds keeps the rotated token without a warning", async () => {
    failingWriteCount = 1;
    const tokenResult = await refreshRegistryAccountToken(EXPIRED_ACCOUNT);
    expect(writeCount).toBe(2);
    expect(tokenResult).toEqual({
      success: true,
      accessToken: "new-access",
      reconnectWarning: null,
    });
  });

  test("a lost write without rotation keeps the stored refresh token usable", async () => {
    failingWriteCount = 1;
    refreshAnswer = {
      ok: true,
      accessToken: "new-access",
      rotatedRefreshToken: null,
      expiresIn: 3600,
    };
    const tokenResult = await refreshRegistryAccountToken(EXPIRED_ACCOUNT);
    expect(writeCount).toBe(1);
    expect(tokenResult).toEqual({
      success: true,
      accessToken: "new-access",
      reconnectWarning: null,
    });
  });

  test("a refused refresh passes its reason through", async () => {
    refreshAnswer = { ok: false, message: "invalid_grant", reason: "auth_expired" };
    const tokenResult = await refreshRegistryAccountToken(EXPIRED_ACCOUNT);
    expect(tokenResult.success ? null : tokenResult.reason).toBe("auth_expired");
  });
});

describe("publishViaRegistry post origin", () => {
  const PUBLISH_CONTENT = {
    account: EXPIRED_ACCOUNT,
    principalId: "principal-1",
    title: null,
    body: "hello",
    mediaUrl: null,
    fileName: "",
    mediaMimeType: "",
    options: {},
    batchId: "batch-1",
    createdVia: "api",
  } as const satisfies Partial<Parameters<typeof publishViaRegistry>[0]>;

  function readStoredScheduledPostId(): unknown {
    const storedRow = storedHistoryRows.at(-1);
    return typeof storedRow === "object" && storedRow !== null && "scheduled_post_id" in storedRow
      ? storedRow.scheduled_post_id
      : "missing";
  }

  test("a post-now publish keys on its dispatch id and records no scheduled post", async () => {
    publishedInputs.length = 0;
    await publishViaRegistry({
      ...PUBLISH_CONTENT,
      postType: "text",
      origin: { kind: "post_now", dispatchId: "dispatch-7" },
    });
    expect(publishedInputs[0]?.idempotencyKey).toBe("dispatch-7");
    expect(publishedInputs[0]?.postType).toBe("text");
    expect(readStoredScheduledPostId()).toBeNull();
  });

  test("a scheduled publish keys on and records its scheduled post", async () => {
    publishedInputs.length = 0;
    await publishViaRegistry({
      ...PUBLISH_CONTENT,
      postType: "text",
      origin: { kind: "scheduled", scheduledPostId: "scheduled-3" },
    });
    expect(publishedInputs[0]?.idempotencyKey).toBe("scheduled-3");
    expect(readStoredScheduledPostId()).toBe("scheduled-3");
  });
});

describe("publishViaRegistry input checks", () => {
  const SCHEDULED_IMAGE_POST = {
    account: EXPIRED_ACCOUNT,
    principalId: "principal-1",
    title: null,
    body: "hello",
    fileName: "photo.png",
    mediaMimeType: "image/png",
    options: {},
    batchId: "batch-1",
    createdVia: "api",
    postType: "image",
    origin: { kind: "scheduled", scheduledPostId: "scheduled-9" },
  } as const satisfies Partial<Parameters<typeof publishViaRegistry>[0]>;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = FIXTURE_STORAGE_BASE_URL;
    publishedInputs.length = 0;
  });

  test("a media URL outside our storage is refused before the provider runs", async () => {
    const outcome = await publishViaRegistry({
      ...SCHEDULED_IMAGE_POST,
      mediaUrl: "https://attacker.example/storage/v1/object/sign/media/photo.png?token=x",
    });
    expect(outcome).toEqual({
      success: false,
      count: 0,
      message: "The post media URL is not a signed URL from our storage.",
      failure: { reason: "invalid_input", mayHavePublished: false },
    });
    expect(publishedInputs).toHaveLength(0);
  });

  test("a signed storage URL reaches the provider", async () => {
    const signedUrl = buildSignedStorageUrlFixture("photo.png");
    await publishViaRegistry({ ...SCHEDULED_IMAGE_POST, mediaUrl: signedUrl });
    expect(publishedInputs[0]?.mediaUrl).toBe(signedUrl);
  });

  test("options of the wrong type are refused with their keys", async () => {
    const outcome = await publishViaRegistry({
      ...SCHEDULED_IMAGE_POST,
      mediaUrl: null,
      options: { communityId: "12", tags: "news" },
    });
    expect(outcome.success ? null : outcome.message).toBe(
      "Malformed post_options: communityId, tags",
    );
    expect(publishedInputs).toHaveLength(0);
  });
});
