import { describe, expect, mock, test } from "bun:test";

import { buildSignedStorageUrlFixture } from "./signedStorageUrlFixture";

mock.module("server-only", () => ({}));

const realUndici = await import("undici");
let servedResponse = new Response(null, { status: 500 });
mock.module("undici", () => ({ ...realUndici, fetch: async () => servedResponse }));

const { fetchStoredMedia, readStoredMediaBytes } = await import("./fetchStoredMedia");

function serveOnce(response: Response): { wasBodyRead: () => boolean } {
  let isBodyRead = false;
  const trackedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      isBodyRead = true;
      const bytes = new Uint8Array(await response.arrayBuffer());
      controller.enqueue(bytes);
      controller.close();
    },
  }, { highWaterMark: 0 });
  const trackedResponse = new Response(trackedBody, {
    status: response.status,
    headers: response.headers,
  });
  servedResponse = trackedResponse;
  return { wasBodyRead: () => isBodyRead };
}

describe("fetchStoredMedia", () => {
  test("refuses a declared size over the limit without reading the body", async () => {
    const served = serveOnce(
      new Response("x".repeat(2048), { headers: { "content-length": "2048" } }),
    );
    const result = await fetchStoredMedia(buildSignedStorageUrlFixture("media.png"), 1024);
    expect(result).toEqual({
      ok: false,
      message: "Media is 2KB; this platform accepts up to 1KB.",
      failure: { reason: "invalid_input", mayHavePublished: false },
    });
    expect(served.wasBodyRead()).toBe(false);
  });

  test("refuses an undeclared body that turns out over the limit", async () => {
    serveOnce(new Response("x".repeat(2048)));
    const result = await fetchStoredMedia(buildSignedStorageUrlFixture("media.png"), 1024);
    expect(result.ok).toBe(false);
  });

  test("returns the bytes as a Blob when within the limit", async () => {
    serveOnce(new Response("hello", { headers: { "content-length": "5" } }));
    const result = await fetchStoredMedia(buildSignedStorageUrlFixture("media.png"), 1024);
    if (!result.ok) throw new Error(result.message);
    expect(await result.media.text()).toBe("hello");
  });

  test("reports a storage error status as a value", async () => {
    serveOnce(new Response("gone", { status: 404 }));
    const result = await fetchStoredMedia(buildSignedStorageUrlFixture("media.png"), 1024);
    expect(result).toEqual({
      ok: false,
      message: "Could not read the post media (HTTP 404).",
      failure: { reason: "transient", mayHavePublished: false },
    });
  });
});

describe("readStoredMediaBytes", () => {
  test("reads the declared size without reading the body", async () => {
    const served = serveOnce(
      new Response("x".repeat(2048), { headers: { "content-length": "2048" } }),
    );
    expect(await readStoredMediaBytes(buildSignedStorageUrlFixture("media.png"))).toEqual({
      ok: true,
      declaredBytes: 2048,
    });
    expect(served.wasBodyRead()).toBe(false);
  });

  test("an undeclared size is null", async () => {
    serveOnce(new Response("hello"));
    expect(await readStoredMediaBytes(buildSignedStorageUrlFixture("media.png"))).toEqual({
      ok: true,
      declaredBytes: null,
    });
  });
});
