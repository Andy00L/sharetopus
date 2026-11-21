import { describe, expect, mock, test } from "bun:test";

import { toJsonObject } from "@/lib/utils/jsonObject";

import { buildSignedStorageUrlFixture } from "./_shared/signedStorageUrlFixture";

import type { ProviderFetchOptions, ProviderFetchResult } from "./_shared/providerFetch";
import type { ProviderPublishInput } from "./types";

mock.module("server-only", () => ({}));

const realProviderFetch = await import("./_shared/providerFetch");
const sentBodies: unknown[] = [];
mock.module("./_shared/providerFetch", () => ({
  ...realProviderFetch,
  providerFetch: async (
    _requestUrl: string,
    options: ProviderFetchOptions,
  ): Promise<ProviderFetchResult> => {
    sentBodies.push(typeof options.body === "string" ? JSON.parse(options.body) : null);
    return {
      ok: true,
      status: 201,
      bodyText: JSON.stringify({ id: 9, url: "https://dev.to/a/9" }),
      headers: {},
    };
  },
}));

const { devtoBehavior } = await import("./devto");

const ARTICLE_POST: ProviderPublishInput = {
  accessToken: "api-key",
  config: {},
  accountIdentifier: "1",
  title: "Release notes",
  body: "Body",
  postType: "text",
  mediaUrl: null,
  fileName: "",
  mediaMimeType: "",
  options: { tags: ["Bun", "typescript", "Testing", "web", "fifth"] },
  idempotencyKey: "post-1",
};

describe("Dev.to article create", () => {
  test("tags go out as an array of at most four lowercase tags", async () => {
    sentBodies.length = 0;
    await devtoBehavior.publish(ARTICLE_POST);
    const article = toJsonObject(toJsonObject(sentBodies.at(-1))?.article);
    expect(article?.tags).toEqual(["bun", "typescript", "testing", "web"]);
  });

  test("an image post sets main_image and leaves the body untouched", async () => {
    sentBodies.length = 0;
    const coverUrl = buildSignedStorageUrlFixture("cover.png");
    await devtoBehavior.publish({ ...ARTICLE_POST, postType: "image", mediaUrl: coverUrl });
    const article = toJsonObject(toJsonObject(sentBodies.at(-1))?.article);
    expect(article?.main_image).toBe(coverUrl);
    expect(article?.body_markdown).toBe("Body");
  });

  test("a body over the catalog limit is refused, not cut", async () => {
    sentBodies.length = 0;
    const published = await devtoBehavior.publish({ ...ARTICLE_POST, body: "x".repeat(100_001) });
    expect(published).toEqual({
      ok: false,
      message: "Dev.to articles are limited to 100000 characters; this one has 100001.",
      failure: { reason: "invalid_input", mayHavePublished: false },
    });
    expect(sentBodies).toHaveLength(0);
  });
});
