import { describe, expect, mock, test } from "bun:test";

import { toJsonObject } from "@/lib/utils/jsonObject";

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
  idempotencyKey: null,
};

describe("Dev.to article create", () => {
  test("tags go out as one comma-separated string of at most four tags", async () => {
    sentBodies.length = 0;
    await devtoBehavior.publish(ARTICLE_POST);
    const article = toJsonObject(toJsonObject(sentBodies.at(-1))?.article);
    expect(article?.tags).toBe("bun, typescript, testing, web");
  });
});
