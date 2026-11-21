import { describe, expect, mock, test } from "bun:test";

import { toJsonObject } from "@/lib/utils/jsonObject";

import type { ProviderFetchOptions, ProviderFetchResult } from "./_shared/providerFetch";
import type { ProviderPublishInput } from "./types";

mock.module("server-only", () => ({}));

const realProviderFetch = await import("./_shared/providerFetch");
const sentCasts: unknown[] = [];
mock.module("./_shared/providerFetch", () => ({
  ...realProviderFetch,
  providerFetch: async (
    _requestUrl: string,
    options: ProviderFetchOptions,
  ): Promise<ProviderFetchResult> => {
    sentCasts.push(typeof options.body === "string" ? JSON.parse(options.body) : null);
    return { ok: true, status: 200, bodyText: '{"cast":{"hash":"0xabc"}}', headers: {} };
  },
}));

const { farcasterBehavior } = await import("./miscCredentials");

const CAST_POST: ProviderPublishInput = {
  accessToken: "neynar-key",
  config: { signerUuid: "signer-1" },
  accountIdentifier: "42",
  title: "",
  body: "hello",
  postType: "text",
  mediaUrl: null,
  fileName: "",
  mediaMimeType: "",
  options: {},
  idempotencyKey: "scheduled-1",
};

async function publishAndReadCast(post: ProviderPublishInput) {
  sentCasts.length = 0;
  await farcasterBehavior.publish(post);
  return toJsonObject(sentCasts.at(-1));
}

describe("Farcaster casts", () => {
  test("text is cut to 320 UTF-8 bytes, not 320 characters", async () => {
    const cast = await publishAndReadCast({ ...CAST_POST, body: "é".repeat(300) });
    const castText = String(cast?.text);
    expect(Buffer.byteLength(castText, "utf8")).toBe(320);
    expect(castText).toBe("é".repeat(160));
  });

  test("a retry of the same post sends the same 16-character idem key", async () => {
    const firstCast = await publishAndReadCast(CAST_POST);
    const retriedCast = await publishAndReadCast(CAST_POST);
    const otherPostCast = await publishAndReadCast({ ...CAST_POST, idempotencyKey: "scheduled-2" });
    expect(String(firstCast?.idem)).toMatch(/^[0-9a-f]{16}$/);
    expect(retriedCast?.idem).toBe(firstCast?.idem);
    expect(otherPostCast?.idem).not.toBe(firstCast?.idem);
  });
});
