import { describe, expect, mock, test } from "bun:test";

import type { ProviderFetchOptions, ProviderFetchResult } from "./_shared/providerFetch";
import type { ProviderPublishInput } from "./types";

mock.module("server-only", () => ({}));

const realProviderFetch = await import("./_shared/providerFetch");
const sentIdempotencyKeys: string[] = [];
mock.module("./_shared/providerFetch", () => ({
  ...realProviderFetch,
  providerFetch: async (
    _requestUrl: string,
    options: ProviderFetchOptions,
  ): Promise<ProviderFetchResult> => {
    sentIdempotencyKeys.push(options.headers?.["Idempotency-Key"] ?? "none");
    return {
      ok: true,
      status: 200,
      bodyText: JSON.stringify({ id: "status-1" }),
      headers: {},
    };
  },
}));

const { mastodonBehavior } = await import("./mastodon");

const TEXT_POST: ProviderPublishInput = {
  accessToken: "token",
  config: { instanceUrl: "https://mastodon.example" },
  accountIdentifier: "account-9",
  title: "",
  body: "Same words",
  postType: "text",
  mediaUrl: null,
  fileName: "",
  mediaMimeType: "",
  options: {},
  idempotencyKey: null,
};

async function publishAndReadKey(post: ProviderPublishInput): Promise<string | undefined> {
  sentIdempotencyKeys.length = 0;
  await mastodonBehavior.publish(post);
  return sentIdempotencyKeys.at(-1);
}

describe("Mastodon Idempotency-Key", () => {
  test("is the post's identity when the worker passes one", async () => {
    expect(await publishAndReadKey({ ...TEXT_POST, idempotencyKey: "scheduled-42" })).toBe(
      "account-9:post:scheduled-42",
    );
  });

  test("two posts with the same text but different identities get different keys", async () => {
    const firstKey = await publishAndReadKey({ ...TEXT_POST, idempotencyKey: "post-a" });
    const secondKey = await publishAndReadKey({ ...TEXT_POST, idempotencyKey: "post-b" });
    expect(firstKey).not.toBe(secondKey);
  });

  test("without an identity, a retry of the same post keeps its key and other media changes it", async () => {
    const firstKey = await publishAndReadKey(TEXT_POST);
    const retryKey = await publishAndReadKey(TEXT_POST);
    const otherMediaKey = await publishAndReadKey({
      ...TEXT_POST,
      postType: "image",
      fileName: "other.png",
    });
    expect(retryKey).toBe(firstKey);
    expect(otherMediaKey).not.toBe(firstKey);
  });
});
