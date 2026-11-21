import "server-only";

import { and, eq, gt } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { scheduled_posts } from "@/db/schema";

export function buildAccessPauseValues(nowIso: string) {
  return {
    status: "cancelled",
    cancelled_by_sub_at: nowIso,
  } satisfies Partial<typeof scheduled_posts.$inferInsert>;
}

export type CancelResult =
  | { success: true; cancelled: number }
  | { success: false; message: string };

export async function cancelFutureScheduledPostsOnSubCancel(
  principalId: string
): Promise<CancelResult> {
  try {
    const nowIso = new Date().toISOString();

    const { data: cancelledRows, error } = await runQuery(
      db
        .update(scheduled_posts)
        .set(buildAccessPauseValues(nowIso))
        .where(
          and(
            eq(scheduled_posts.principal_id, principalId),
            eq(scheduled_posts.status, "scheduled"),
            gt(scheduled_posts.scheduled_at, nowIso),
          ),
        )
        .returning({ id: scheduled_posts.id }),
    );

    if (error) {
      return {
        success: false,
        message: `[cancelFutureScheduledPostsOnSubCancel] ${error.message}`,
      };
    }

    const count = cancelledRows.length;
    if (count > 0) {
      console.log(
        `[cancelFutureScheduledPostsOnSubCancel] Cancelled ${count} future posts for ${principalId}`
      );
    }
    return { success: true, cancelled: count };
  } catch (err) {
    return {
      success: false,
      message: `[cancelFutureScheduledPostsOnSubCancel] Unexpected: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
