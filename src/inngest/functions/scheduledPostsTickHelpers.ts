import "server-only";

import { and, asc, inArray, lte } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { scheduled_posts } from "@/db/schema";
import type { PostStatus } from "@/db/schema";
import { POST_DUE_TARGET_COLUMNS } from "@/inngest/dispatch/sendPostDueEvents";
import type { PostDueTarget } from "@/inngest/events/postDue";

const UNCLAIMED_POST_STATUSES: PostStatus[] = ["scheduled", "queued"];

export type FetchUnclaimedPostsResult =
  | { success: true; targets: PostDueTarget[] }
  | { success: false; message: string };

export async function fetchUnclaimedPostsDueBy(input: {
  dueByIso: string;
  limit: number;
}): Promise<FetchUnclaimedPostsResult> {
  const { data, error } = await runQuery(
    db
      .select(POST_DUE_TARGET_COLUMNS)
      .from(scheduled_posts)
      .where(
        and(
          inArray(scheduled_posts.status, UNCLAIMED_POST_STATUSES),
          lte(scheduled_posts.scheduled_at, input.dueByIso),
        ),
      )
      .orderBy(asc(scheduled_posts.scheduled_at))
      .limit(input.limit),
  );

  if (error) {
    console.error("[fetchUnclaimedPostsDueBy] fetch failed:", error.message);
    return { success: false, message: `Failed to fetch due posts: ${error.message}` };
  }
  return { success: true, targets: data };
}
