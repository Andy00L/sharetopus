import { describe, expect, mock, test } from "bun:test";

import type { ProviderFetchResult } from "./_shared/providerFetch";
import type { ProviderPublishInput } from "./types";

mock.module("server-only", () => ({}));

const BYTES_PER_MB = 1024 * 1024;
let storedMediaBytes: number | null = null;
mock.module("./_shared/fetchStoredMedia", () => ({
  BYTES_PER_MB,
  readStoredMediaBytes: async () => ({ ok: true, declaredBytes: storedMediaBytes }),
}));

const realProviderFetch = await import("./_shared/providerFetch");
const requestedMethods: string[] = [];
mock.module("./_shared/providerFetch", () => ({
  ...realProviderFetch,
  providerFetch: async (requestUrl: string): Promise<ProviderFetchResult> => {
    requestedMethods.push(requestUrl.split("/").at(-1) ?? "");
    return {
      ok: true,
      status: 200,
      bodyText: JSON.stringify({ ok: true, result: { message_id: 42 } }),
      headers: {},
    };
  },
}));

const { telegramBehavior } = await import("./telegram");

const PHOTO_POST: ProviderPublishInput = {
  accessToken: "123:bot-token",
  config: { chatId: "@channel" },
  accountIdentifier: "@channel",
  title: "",
  body: "New photo",
  postType: "image",
  mediaUrl: "https://storage.test/photo.png",
  fileName: "photo.png",
  mediaMimeType: "image/png",
  options: {},
  idempotencyKey: null,
};

describe("Telegram media sent by link", () => {
  test("a photo over 5 MB is refused before any Telegram request", async () => {
    requestedMethods.length = 0;
    storedMediaBytes = 6 * BYTES_PER_MB;
    const published = await telegramBehavior.publish(PHOTO_POST);
    expect(published).toEqual({
      ok: false,
      message: "Telegram accepts photos sent by link up to 5 MB; this file is 6.0 MB.",
      failure: { reason: "invalid_input", mayHavePublished: false },
    });
    expect(requestedMethods).toEqual([]);
  });

  test("a 6 MB video is under the 20 MB cap and is sent", async () => {
    requestedMethods.length = 0;
    storedMediaBytes = 6 * BYTES_PER_MB;
    const published = await telegramBehavior.publish({
      ...PHOTO_POST,
      postType: "video",
      mediaUrl: "https://storage.test/clip.mp4",
    });
    expect(published.ok).toBe(true);
    expect(requestedMethods).toEqual(["sendVideo"]);
  });

  test("an unknown size is left for Telegram to judge", async () => {
    requestedMethods.length = 0;
    storedMediaBytes = null;
    const published = await telegramBehavior.publish(PHOTO_POST);
    expect(published.ok).toBe(true);
    expect(requestedMethods).toEqual(["sendPhoto"]);
  });
});
