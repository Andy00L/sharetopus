import { describe, expect, test } from "bun:test";

import { normalizeSubredditName } from "./subredditName";

describe("normalizeSubredditName", () => {
  test("an r/ prefix and surrounding spaces are dropped", () => {
    expect(normalizeSubredditName(" r/cooking ")).toBe("cooking");
    expect(normalizeSubredditName("/r/AskHistorians")).toBe("AskHistorians");
  });

  test("names outside Reddit's 2 to 21 word characters are refused", () => {
    expect(normalizeSubredditName("a")).toBeNull();
    expect(normalizeSubredditName("x".repeat(22))).toBeNull();
    expect(normalizeSubredditName("cooking/../api")).toBeNull();
    expect(normalizeSubredditName("")).toBeNull();
  });
});
