import { describe, expect, test } from "bun:test";

import { findPostTargetIssues } from "./postTargetOptions";

describe("findPostTargetIssues pin link", () => {
  test("a pin link on a non-Pinterest post is refused by name", () => {
    expect(
      findPostTargetIssues({
        platform: "linkedin",
        post_type: "text",
        pinterest_link: "https://example.com/article",
      }),
    ).toEqual([
      { path: "pinterest_link", message: "pinterest_link is only valid when platform is pinterest" },
    ]);
  });

  test("a pin link on a Pinterest post with its board is accepted", () => {
    expect(
      findPostTargetIssues({
        platform: "pinterest",
        post_type: "image",
        pinterest_board_id: "board-1",
        pinterest_link: "https://example.com/article",
      }),
    ).toEqual([]);
  });
});
