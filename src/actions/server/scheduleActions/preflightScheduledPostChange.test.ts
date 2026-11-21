import { describe, expect, mock, test } from "bun:test";

import type { PostStatus } from "@/db/schema";

mock.module("server-only", () => ({}));
mock.module("@/db/client", () => ({ db: {}, runQuery: async () => ({ data: [], error: null }) }));

const { checkPostChangeRules, POST_CHANGE_ELIGIBLE_STATUSES } = await import(
  "./preflightScheduledPostChange"
);

const PRINCIPAL_ID = "principal-1";

function buildPost(id: string, status: PostStatus, principalId = PRINCIPAL_ID) {
  return { id, principal_id: principalId, status };
}

describe("checkPostChangeRules", () => {
  test("another principal's post refuses the whole change and names it", () => {
    expect(
      checkPostChangeRules({
        posts: [buildPost("post-1", "scheduled"), buildPost("post-2", "scheduled", "intruder")],
        principalId: PRINCIPAL_ID,
        eligibleStatuses: POST_CHANGE_ELIGIBLE_STATUSES.cancel,
      }),
    ).toEqual({ ok: false, violation: "not_owned", foreignPostIds: ["post-2"] });
  });

  test("only posts in an eligible status are changed", () => {
    const scheduledPost = buildPost("post-1", "scheduled");
    expect(
      checkPostChangeRules({
        posts: [scheduledPost, buildPost("post-2", "posted")],
        principalId: PRINCIPAL_ID,
        eligibleStatuses: POST_CHANGE_ELIGIBLE_STATUSES.cancel,
      }),
    ).toEqual({ ok: true, eligiblePosts: [scheduledPost] });
    expect(
      checkPostChangeRules({
        posts: [buildPost("post-2", "posted")],
        principalId: PRINCIPAL_ID,
        eligibleStatuses: POST_CHANGE_ELIGIBLE_STATUSES.reschedule,
      }),
    ).toEqual({ ok: false, violation: "not_eligible" });
  });

  test("delete applies to every status, and no match is not found", () => {
    const postedPost = buildPost("post-2", "posted");
    expect(
      checkPostChangeRules({
        posts: [postedPost],
        principalId: PRINCIPAL_ID,
        eligibleStatuses: POST_CHANGE_ELIGIBLE_STATUSES.delete,
      }),
    ).toEqual({ ok: true, eligiblePosts: [postedPost] });
    expect(
      checkPostChangeRules({ posts: [], principalId: PRINCIPAL_ID, eligibleStatuses: null }),
    ).toEqual({ ok: false, violation: "not_found" });
  });
});
