import { describe, expect, test } from "bun:test";

import { isOwnedMediaPath } from "./mediaPath";

const PRINCIPAL_ID = "user_abc";

describe("isOwnedMediaPath", () => {
  test("accepts the {principalId}/{uuid}.{ext} paths the uploaders mint", () => {
    expect(isOwnedMediaPath("user_abc/0b5c2a8e-1f7d-4c39-9a51-2f4e8d1c6b70.mp4", PRINCIPAL_ID)).toBe(true);
  });

  test("rejects a path that climbs out of the principal's folder", () => {
    for (const climbingPath of [
      "user_abc/../user_xyz/video.mp4",
      "user_abc/..",
      "user_abc/./../user_xyz/video.mp4",
      "user_abc/%2e%2e/user_xyz/video.mp4",
      "user_abc/..\\user_xyz\\video.mp4",
    ]) {
      expect(isOwnedMediaPath(climbingPath, PRINCIPAL_ID)).toBe(false);
    }
  });

  test("rejects another principal's folder, a shared prefix, and empty segments", () => {
    for (const foreignPath of [
      "user_xyz/video.mp4",
      "user_abcdef/video.mp4",
      "user_abc",
      "user_abc/",
      "user_abc//video.mp4",
      "/user_abc/video.mp4",
    ]) {
      expect(isOwnedMediaPath(foreignPath, PRINCIPAL_ID)).toBe(false);
    }
    expect(isOwnedMediaPath("/video.mp4", "")).toBe(false);
  });
});
