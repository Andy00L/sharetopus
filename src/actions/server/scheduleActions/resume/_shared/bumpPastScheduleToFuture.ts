import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { scheduled_posts } from "@/db/schema";

const RESUME_BUFFER_MS = 60 * 60 * 1000;

export type ResumeSchedule = {
  bumpedAtIso: string;
  scheduledAt: SQL<string>;
};

export function buildResumeSchedule(now: Date): ResumeSchedule {
  const nowIso = now.toISOString();
  const bumpedAtIso = new Date(now.getTime() + RESUME_BUFFER_MS).toISOString();
  return {
    bumpedAtIso,
    scheduledAt: sql<string>`case when ${scheduled_posts.scheduled_at} > ${nowIso} then ${scheduled_posts.scheduled_at} else ${bumpedAtIso}::timestamptz end`,
  };
}

export function countBumpedRows(
  resumedRows: { scheduled_at: string }[],
  bumpedAtIso: string,
): number {
  const bumpedAtMs = new Date(bumpedAtIso).getTime();
  return resumedRows.filter(
    (resumedRow) => new Date(resumedRow.scheduled_at).getTime() === bumpedAtMs,
  ).length;
}
