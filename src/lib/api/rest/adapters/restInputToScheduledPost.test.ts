import { describe, expect, test } from "bun:test";

import type { PostCreateInput } from "../validation/schemas";
import { restInputToDirectPostData } from "./restInputToScheduledPost";

function buildInput(overrides: Partial<PostCreateInput>): PostCreateInput {
  return {
    social_account_id: "8f14e45f-ceea-467a-9575-1b2f3c4d5e6f",
    platform: "pinterest",
    post_type: "image",
    description: "Caption",
    media_storage_path: "principal-1/pin.jpg",
    pinterest_board_id: "board-1",
    pinterest_link: "https://example.com/recipe",
    subreddit: "cooking",
    ...overrides,
  };
}

describe("restInputToDirectPostData", () => {
  test("the Pinterest link becomes the post link only for a Pinterest post", () => {
    expect(restInputToDirectPostData(buildInput({})).link).toBe("https://example.com/recipe");
    expect(restInputToDirectPostData(buildInput({ platform: "linkedin" })).link).toBeUndefined();
  });

  test("registry options travel as registryOptions", () => {
    expect(
      restInputToDirectPostData(buildInput({ platform: "reddit", post_type: "text" })).registryOptions,
    ).toEqual({ subreddit: "cooking" });
  });
});
