import { beforeEach, describe, expect, mock, test } from "bun:test";

type SentEvent = { name: string; data: Record<string, unknown>; validate?: () => Promise<void> };

const sentBatches: SentEvent[][] = [];

mock.module("server-only", () => ({}));
mock.module("@vercel/functions", () => ({ waitUntil: () => undefined }));
mock.module("@/db/client", () => ({
  db: {},
  runQuery: async () => ({ data: [], error: null }),
}));
mock.module("@/inngest/client", () => ({
  inngest: {
    send: async (events: SentEvent[]) => {
      sentBatches.push(events);
      return { ids: events.map((event, eventIndex) => `${event.name}-${eventIndex}`) };
    },
  },
}));

const { sendWebhookDispatchEvent } = await import("./dispatch");

const STORED_DELIVERY = {
  subscriptionId: "subscription-1",
  eventType: "post.published",
  eventId: "event-1",
};

beforeEach(() => {
  sentBatches.length = 0;
});

describe("sendWebhookDispatchEvent (replay of a stored delivery)", () => {
  test("a stored JSON object is sent as a webhook.dispatch.v1 event that passes the event schema", async () => {
    const result = await sendWebhookDispatchEvent({
      ...STORED_DELIVERY,
      payload: { post_id: "post-1", platform: "x", extra: { attempts: [1, 2], note: null } },
    });

    expect(result).toEqual({ ok: true });
    expect(sentBatches).toHaveLength(1);
    const [sentEvent] = sentBatches[0];
    expect(sentEvent).toMatchObject({
      name: "webhook.dispatch.v1",
      data: {
        subscription_id: "subscription-1",
        event_type: "post.published",
        event_id: "event-1",
        payload: { post_id: "post-1", platform: "x", extra: { attempts: [1, 2], note: null } },
      },
    });
    await expect(sentEvent.validate?.()).resolves.toBeUndefined();
  });

  test("a stored payload that is not a JSON object is refused before any send", async () => {
    const result = await sendWebhookDispatchEvent({ ...STORED_DELIVERY, payload: ["post-1"] });

    expect(result).toEqual({ ok: false, message: "Stored webhook payload is not a JSON object" });
    expect(sentBatches).toHaveLength(0);
  });
});
