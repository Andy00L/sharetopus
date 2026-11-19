import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { scheduled_posts } from "@/db/schema";

/**
 * How far ahead a resumed post whose time already passed is rescheduled:
 * time for the dispatcher to pick it up, and for the user to cancel again
 * if they did not mean to resume it.
 */
const RESUME_BUFFER_MS = 60 * 60 * 1000;

export type ResumeSchedule = {
  /** The time every past-due resumed post moves to. */
  bumpedAtIso: string;
  /** scheduled_at for an UPDATE: the post's own time if still after `now`, else bumpedAtIso. */
  scheduledAt: SQL<string>;
};

/**
 * The scheduled_at a resumed post gets, as SQL, so one UPDATE resumes every
 * post of a batch whatever its time. Used by the manual resume and by the
 * resume on resubscribe.
 */
export function buildResumeSchedule(now: Date): ResumeSchedule {
  const nowIso = now.toISOString();
  const bumpedAtIso = new Date(now.getTime() + RESUME_BUFFER_MS).toISOString();
  return {
    bumpedAtIso,
    scheduledAt: sql<string>`case when ${scheduled_posts.scheduled_at} > ${nowIso} then ${scheduled_posts.scheduled_at} else ${bumpedAtIso}::timestamptz end`,
  };
}

/** How many resumed rows were moved to bumpedAtIso, from the scheduled_at the UPDATE returned. */
export function countBumpedRows(
  resumedRows: { scheduled_at: string }[],
  bumpedAtIso: string,
): number {
  const bumpedAtMs = new Date(bumpedAtIso).getTime();
  return resumedRows.filter(
    (resumedRow) => new Date(resumedRow.scheduled_at).getTime() === bumpedAtMs,
  ).length;
}
