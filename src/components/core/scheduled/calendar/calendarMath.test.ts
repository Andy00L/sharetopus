import { describe, expect, test } from "bun:test";

import type { ScheduledPostListItem } from "@/lib/types/dbTypes";
import { groupPostsIntoBatches, isBatchDraggable } from "./calendarMath";

function buildPost(
  overrides: Pick<ScheduledPostListItem, "id" | "scheduled_at"> &
    Partial<ScheduledPostListItem>,
): ScheduledPostListItem {
  return {
    status: "scheduled",
    platform: "linkedin",
    post_title: null,
    post_description: null,
    error_message: null,
    media_type: "text",
    media_storage_path: "",
    batch_id: null,
    created_via: "web",
    social_accounts: null,
    ...overrides,
  };
}

describe("groupPostsIntoBatches", () => {
  test("posts without a batch id stay separate batches, shared ids group", () => {
    const batches = groupPostsIntoBatches([
      buildPost({ id: "lone-a", scheduled_at: "2026-12-01T10:00:00.000Z" }),
      buildPost({ id: "lone-b", scheduled_at: "2026-12-01T09:00:00.000Z" }),
      buildPost({ id: "pair-1", scheduled_at: "2026-12-01T11:00:00.000Z", batch_id: "pair" }),
      buildPost({ id: "pair-2", scheduled_at: "2026-12-01T11:00:00.000Z", batch_id: "pair" }),
    ]);

    expect(batches.map((batch) => batch.batchId)).toEqual(["lone-b", "lone-a", "pair"]);
    expect(batches[2].posts.map((post) => post.id)).toEqual(["pair-1", "pair-2"]);
  });

  test("a batch moves while any post is scheduled or cancelled", () => {
    const [postedOnly, cancelledAndFailed] = groupPostsIntoBatches([
      buildPost({ id: "posted", scheduled_at: "2026-12-01T10:00:00.000Z", status: "posted" }),
      buildPost({ id: "cancelled", scheduled_at: "2026-12-02T10:00:00.000Z", batch_id: "mixed", status: "cancelled" }),
      buildPost({ id: "failed", scheduled_at: "2026-12-02T10:00:00.000Z", batch_id: "mixed", status: "failed" }),
    ]);

    expect(isBatchDraggable(postedOnly)).toBe(false);
    expect(isBatchDraggable(cancelledAndFailed)).toBe(true);
  });
});
