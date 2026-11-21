import { describe, expect, test } from "bun:test";

import { resolvePlatformTextLimit } from "@/components/core/create/constants/captionLimits";

import { validatePostFields, type PostFieldsToValidate } from "./validatePostFields";

const PRINCIPAL_ID = "principal-1";

function buildPost(overrides: Partial<PostFieldsToValidate>): PostFieldsToValidate {
  return {
    socialAccountId: "account-1",
    platform: "x",
    postType: "text",
    mediaStoragePath: "",
    description: "hello",
    link: undefined,
    pinterestBoardId: undefined,
    ...overrides,
  };
}

describe("validatePostFields", () => {
  test("a caption over the platform limit is refused for scheduled and post-now alike", () => {
    const xLimit = resolvePlatformTextLimit("x");
    expect(validatePostFields(buildPost({ description: "a".repeat(xLimit + 1) }), PRINCIPAL_ID)).toBe(
      `Caption exceeds x limit of ${xLimit} chars (got ${xLimit + 1}).`,
    );
    expect(validatePostFields(buildPost({ description: "a".repeat(xLimit) }), PRINCIPAL_ID)).toBeNull();
  });

  test("Pinterest needs a board and no other platform takes one", () => {
    expect(validatePostFields(buildPost({ platform: "pinterest", postType: "image", mediaStoragePath: `${PRINCIPAL_ID}/a.jpg` }), PRINCIPAL_ID)).toBe(
      "Pinterest posts require a board.",
    );
    expect(validatePostFields(buildPost({ pinterestBoardId: "board-1" }), PRINCIPAL_ID)).toBe(
      "A board is only valid when platform='pinterest'.",
    );
  });

  test("a link is accepted where an adapter reads it, refused elsewhere", () => {
    expect(validatePostFields(buildPost({ platform: "linkedin", link: "https://example.com" }), PRINCIPAL_ID)).toBeNull();
    expect(validatePostFields(buildPost({ link: "https://example.com" }), PRINCIPAL_ID)).toBe(
      "A link is only valid for Pinterest and LinkedIn posts.",
    );
  });

  test("media must exist for media posts and sit in the caller's folder", () => {
    expect(validatePostFields(buildPost({ postType: "video" }), PRINCIPAL_ID)).toBe(
      "Media file is required for video posts.",
    );
    expect(
      validatePostFields(buildPost({ postType: "video", mediaStoragePath: "someone-else/a.mp4" }), PRINCIPAL_ID),
    ).toBe("Media path is not owned by the calling principal.");
  });

  test("a path that starts in the caller's folder but climbs out of it is refused", () => {
    for (const escapingPath of [
      `${PRINCIPAL_ID}/../someone-else/a.mp4`,
      `${PRINCIPAL_ID}/%2e%2e/someone-else/a.mp4`,
      `${PRINCIPAL_ID}//a.mp4`,
    ]) {
      expect(
        validatePostFields(buildPost({ postType: "video", mediaStoragePath: escapingPath }), PRINCIPAL_ID),
      ).toBe("Media path is not owned by the calling principal.");
    }
    expect(
      validatePostFields(buildPost({ postType: "video", mediaStoragePath: `${PRINCIPAL_ID}/clips/a.mp4` }), PRINCIPAL_ID),
    ).toBeNull();
  });
});
