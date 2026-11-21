import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { PostBodyBaseSchema, SchedulePostOptionsSchema, withPostTypeRules } = await import("./postBodySchema");

const PostBodySchema = withPostTypeRules(PostBodyBaseSchema);

function buildBody(overrides: Record<string, unknown>) {
  return {
    social_account_id: "6f1f6a43-2b3c-4d5e-8f90-0a1b2c3d4e5f",
    platform: "linkedin",
    post_type: "text",
    description: "Hello",
    ...overrides,
  };
}

function readIssueMessages(body: Record<string, unknown>): string[] {
  const parsed = PostBodySchema.safeParse(body);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

describe("x402 post body rules checked before payment", () => {
  test("a text post to a platform without text posts is refused", () => {
    expect(readIssueMessages(buildBody({ platform: "tiktok" }))).toEqual([
      "TikTok does not accept text posts.",
    ]);
    expect(readIssueMessages(buildBody({ platform: "pinterest" }))).toEqual([
      "Pinterest does not accept text posts.",
    ]);
  });

  test("a LinkedIn text post and a TikTok video with media pass", () => {
    expect(readIssueMessages(buildBody({}))).toEqual([]);
    expect(
      readIssueMessages(
        buildBody({ platform: "tiktok", post_type: "video", media_storage_path: "principal/a.mp4" }),
      ),
    ).toEqual([]);
  });

  test("an image post without a media path is refused", () => {
    expect(readIssueMessages(buildBody({ post_type: "image" }))).toEqual([
      "media_storage_path is required for image and video posts.",
    ]);
  });
});

describe("x402 schedule post_options", () => {
  test("drops privacyLevel, so x402 TikTok and Pinterest posts stay public", () => {
    const parsed = SchedulePostOptionsSchema.parse({ privacyLevel: "SELF_ONLY", disableDuet: true });

    expect(parsed).not.toHaveProperty("privacyLevel");
    expect(parsed.disableDuet).toBe(true);
  });

  test("reads the option keys the stored decoder reads and stores null as unset", () => {
    const parsed = SchedulePostOptionsSchema.parse({
      link: "https://example.com/a",
      board: "board-1",
      privacyStatus: "unlisted",
      disableComment: null,
    });

    expect(parsed).toMatchObject({ link: "https://example.com/a", board: "board-1", privacyStatus: "unlisted" });
    expect(parsed.disableComment).toBeUndefined();
  });

  test("keeps the input limits on free-text fields", () => {
    expect(SchedulePostOptionsSchema.safeParse({ link: "not a url" }).success).toBe(false);
    expect(SchedulePostOptionsSchema.safeParse({ visibility: "x".repeat(33) }).success).toBe(false);
  });
});
