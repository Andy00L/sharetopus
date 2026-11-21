import { describe, expect, mock, test } from "bun:test";

import type { ProviderFetchOptions, ProviderFetchResult } from "./_shared/providerFetch";
import { toJsonObject } from "@/lib/utils/jsonObject";

import type { ProviderPublishInput } from "./types";

mock.module("server-only", () => ({}));

const realProviderFetch = await import("./_shared/providerFetch");
const sentPayloads: unknown[] = [];
mock.module("./_shared/providerFetch", () => ({
  ...realProviderFetch,
  providerFetch: async (
    _requestUrl: string,
    options: ProviderFetchOptions,
  ): Promise<ProviderFetchResult> => {
    sentPayloads.push(typeof options.body === "string" ? JSON.parse(options.body) : null);
    return { ok: true, status: 200, bodyText: '{"ok":true,"ts":"1700.1"}', headers: {} };
  },
}));

const { slackBehavior } = await import("./slack");

const IMAGE_POST: ProviderPublishInput = {
  accessToken: "xoxb-token",
  config: { channelId: "C123" },
  accountIdentifier: "T1:C123",
  title: "",
  body: "",
  postType: "image",
  mediaUrl: "https://storage.test/photo.png",
  fileName: "photo.png",
  mediaMimeType: "image/png",
  options: {},
  idempotencyKey: null,
};

async function publishAndReadBlocks(post: ProviderPublishInput): Promise<unknown[]> {
  sentPayloads.length = 0;
  await slackBehavior.publish(post);
  const blocks = toJsonObject(sentPayloads.at(-1))?.blocks;
  return Array.isArray(blocks) ? blocks : [];
}

function readSectionTexts(blocks: unknown[]): string[] {
  return blocks
    .map((block) => toJsonObject(block))
    .filter((block) => block?.type === "section")
    .map((block) => String(toJsonObject(block?.text)?.text));
}

describe("Slack image posts", () => {
  test("a long message is split into sections of at most 3,000 characters", async () => {
    const longBody = "word ".repeat(1400).trim();
    const blocks = await publishAndReadBlocks({ ...IMAGE_POST, body: longBody });
    const sectionTexts = readSectionTexts(blocks);
    expect(sectionTexts.length).toBe(3);
    expect(sectionTexts.every((sectionText) => sectionText.length <= 3000)).toBe(true);
    expect(sectionTexts.join(" ")).toBe(longBody);
  });

  test("an image without text sends no empty section", async () => {
    const blocks = await publishAndReadBlocks(IMAGE_POST);
    expect(readSectionTexts(blocks)).toEqual([]);
    expect(blocks.length).toBe(1);
  });
});
