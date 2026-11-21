import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { digestRequestBody } from "./requestDigest";

const SOCIAL_ACCOUNT_ID = "5b1f0c4e-3d2a-4f6b-8c9d-0e1f2a3b4c5d";

describe("digestRequestBody", () => {
  test("is the SHA-256 of the body as JSON with sorted keys and no whitespace, absent keys dropped and null kept", () => {
    const canonicalJson = `{"description":"Launch day. ✓","platform":"linkedin","post_type":"text","social_account_id":"${SOCIAL_ACCOUNT_ID}","title":null}`;

    const requestDigest = digestRequestBody({
      social_account_id: SOCIAL_ACCOUNT_ID,
      title: null,
      platform: "linkedin",
      media_storage_path: undefined,
      post_type: "text",
      description: "Launch day. ✓",
    });

    expect(requestDigest).toBe(createHash("sha256").update(canonicalJson, "utf8").digest("hex"));
  });

  test("the same fields in another key order, also inside nested objects, give the same digest", () => {
    const firstOrder = digestRequestBody({
      platform: "pinterest",
      cover_timestamp: 1500,
      options: { board: "board-1", link: "https://example.com/a", tags: ["a", "b"] },
    });
    const secondOrder = digestRequestBody({
      options: { tags: ["a", "b"], link: "https://example.com/a", board: "board-1" },
      cover_timestamp: 1500,
      platform: "pinterest",
    });

    expect(secondOrder).toBe(firstOrder);
  });

  test("a different value, a null in place of an absent key, or a reordered array changes the digest", () => {
    const firstDigest = digestRequestBody({ description: "Launch day.", tags: ["a", "b"] });

    expect(digestRequestBody({ description: "Launch day!", tags: ["a", "b"] })).not.toBe(firstDigest);
    expect(digestRequestBody({ description: "Launch day.", tags: ["a", "b"], title: null })).not.toBe(firstDigest);
    expect(digestRequestBody({ description: "Launch day.", tags: ["b", "a"] })).not.toBe(firstDigest);
  });
});
