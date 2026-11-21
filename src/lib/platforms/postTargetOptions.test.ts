import { describe, expect, test } from "bun:test";

import {
  buildRegistryPostOptions,
  findPostTargetIssues,
  RegistryPostOptionsSchema,
} from "./postTargetOptions";

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

describe("subreddit option", () => {
  test("a name with its r/ prefix is accepted and stored bare", () => {
    const parsed = RegistryPostOptionsSchema.parse({ subreddit: "r/cooking" });
    expect(buildRegistryPostOptions(parsed)).toEqual({ subreddit: "cooking" });
  });

  test("a name that is not a subreddit is refused at input", () => {
    expect(RegistryPostOptionsSchema.safeParse({ subreddit: "cooking/../api" }).success).toBe(false);
  });
});
