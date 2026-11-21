import { describe, expect, mock, test } from "bun:test";

import type { ProviderFetchOptions, ProviderFetchResult } from "./_shared/providerFetch";
import type { ProviderPublishInput } from "./types";

mock.module("server-only", () => ({}));

const realProviderFetch = await import("./_shared/providerFetch");
const sentBodies: unknown[] = [];
let nextAnswer: ProviderFetchResult = { ok: true, status: 200, bodyText: "{}", headers: {} };
mock.module("./_shared/providerFetch", () => ({
  ...realProviderFetch,
  providerFetch: async (_requestUrl: string, options: ProviderFetchOptions) => {
    sentBodies.push(typeof options.body === "string" ? JSON.parse(options.body) : null);
    return nextAnswer;
  },
}));

const { kickBehavior, twitchBehavior } = await import("./twitchKick");

function answerJson(body: Record<string, unknown>): ProviderFetchResult {
  return { ok: true, status: 200, bodyText: JSON.stringify(body), headers: {} };
}

const CHAT_POST: ProviderPublishInput = {
  accessToken: "token",
  config: { broadcasterUserId: "123", broadcasterId: "456" },
  accountIdentifier: "123",
  title: "",
  body: "We are live",
  postType: "text",
  mediaUrl: null,
  fileName: "",
  mediaMimeType: "",
  options: {},
  idempotencyKey: "post-1",
};

describe("Kick chat send", () => {
  test("a sent message returns Kick's message id and names the broadcaster", async () => {
    sentBodies.length = 0;
    nextAnswer = answerJson({ data: { is_sent: true, message_id: "msg-1" } });
    expect(await kickBehavior.publish(CHAT_POST)).toEqual({
      ok: true,
      postId: "msg-1",
      postUrl: null,
    });
    expect(sentBodies).toEqual([
      { content: "We are live", type: "user", broadcaster_user_id: 123 },
    ]);
  });

  test("is_sent false is a refusal that published nothing", async () => {
    nextAnswer = answerJson({ data: { is_sent: false, message_id: "" } });
    const published = await kickBehavior.publish(CHAT_POST);
    expect(published.ok ? null : published.failure).toEqual({
      reason: "policy_rejected",
      mayHavePublished: false,
    });
  });

  test("an answer without is_sent is an unknown outcome, not a fabricated id", async () => {
    nextAnswer = answerJson({ data: {} });
    const published = await kickBehavior.publish(CHAT_POST);
    expect(published.ok ? null : published.failure).toEqual({
      reason: "unknown",
      mayHavePublished: true,
    });
  });
});

describe("Kick message limits", () => {
  test("a message is cut to 2,048 UTF-8 bytes without breaking an emoji", async () => {
    sentBodies.length = 0;
    nextAnswer = answerJson({ data: { is_sent: true, message_id: "msg-2" } });
    const familyEmoji = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    await kickBehavior.publish({ ...CHAT_POST, body: familyEmoji.repeat(200) });
    const sentBody = sentBodies.at(-1);
    const content =
      typeof sentBody === "object" && sentBody !== null && "content" in sentBody
        ? String(sentBody.content)
        : "";
    expect(Buffer.byteLength(content, "utf8")).toBeLessThanOrEqual(2048);
    expect(content).toBe(familyEmoji.repeat(113));
  });
});

describe("Twitch chat send", () => {
  test("a dropped message reports Twitch's drop reason", async () => {
    const previousClientId = process.env.TWITCH_CLIENT_ID;
    process.env.TWITCH_CLIENT_ID = "client";
    nextAnswer = answerJson({
      data: [
        {
          message_id: "",
          is_sent: false,
          drop_reason: { code: "msg_duplicate", message: "duplicate message" },
        },
      ],
    });
    const published = await twitchBehavior.publish(CHAT_POST);
    if (previousClientId === undefined) delete process.env.TWITCH_CLIENT_ID;
    else process.env.TWITCH_CLIENT_ID = previousClientId;
    expect(published).toEqual({
      ok: false,
      message: "Twitch dropped the chat message (duplicate message).",
      failure: { reason: "policy_rejected", mayHavePublished: false },
    });
  });
});
