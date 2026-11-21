import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

mock.module("@/lib/net/pinnedFetch", () => ({
  resolveHostToPublicAddresses: async () => ({
    ok: true,
    addresses: [{ address: "203.0.113.10", family: 4 }],
  }),
  acquirePinnedDispatcher: () => undefined,
}));

const realUndici = await import("undici");
let servedResponse = new Response("");
mock.module("undici", () => ({ ...realUndici, fetch: async () => servedResponse }));

const { providerFetch } = await import("./providerFetch");

const READ_LIMIT_BYTES = 256 * 1024;

function fetchProvider() {
  return providerFetch("https://api.provider.test/v1/posts", {
    method: "POST",
    body: "{}",
    timeoutMs: 1_000,
  });
}

describe("providerFetch body reads", () => {
  test("a body over the read limit is reported, not cut", async () => {
    servedResponse = new Response("x".repeat(READ_LIMIT_BYTES + 1), { status: 200 });
    const fetchResult = await fetchProvider();
    expect(fetchResult).toMatchObject({ ok: false, kind: "unreadable_body", status: 200 });
  });

  test("a body exactly at the read limit is returned whole", async () => {
    servedResponse = new Response("x".repeat(READ_LIMIT_BYTES), { status: 200 });
    const fetchResult = await fetchProvider();
    expect(fetchResult.ok ? fetchResult.bodyText.length : null).toBe(READ_LIMIT_BYTES);
  });

  test("a body that breaks mid-read is reported with its status", async () => {
    const brokenBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"id":'));
        controller.error(new Error("connection reset"));
      },
    });
    servedResponse = new Response(brokenBody, { status: 201 });
    const fetchResult = await fetchProvider();
    expect(fetchResult).toEqual({
      ok: false,
      kind: "unreadable_body",
      status: 201,
      message: "Provider answered HTTP 201 but its body could not be read: connection reset.",
    });
  });
});
