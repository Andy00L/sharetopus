import {
  addDays,
  eachDayOfInterval,
  format,
  parse,
  setHours,
  setMinutes,
  setSeconds,
  startOfMonth,
  startOfWeek,
} from "date-fns";

import type { ScheduledPostListItem } from "@/lib/types/dbTypes";
import { summarizeBatchStatus, type BatchStatus } from "../statusStyles";

/**
 * Pure date and grouping helpers behind the schedule calendar. No React,
 * no DOM: everything here is unit-testable math so the components stay
 * declarative.
 *
 * All day math runs in the viewer's local timezone on purpose: the rest of
 * the scheduling UI (SchedulingPanel, BatchedPostCard) already formats
 * scheduled_at with local-time date-fns calls, and the calendar must agree
 * with those labels cell for cell.
 */

/** Monday, matching scheduling-tool convention. date-fns weekStartsOn. */
export const WEEK_STARTS_ON = 1;

export type CalendarView = "month" | "week";

/** Cells in a month grid: 6 weeks x 7 days covers every month layout. */
const MONTH_GRID_DAY_COUNT = 42;

/** yyyy-MM-dd in local time; the droppable/grouping key for one day. */
export function formatDayKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function parseDayKey(dayKey: string): Date {
  return parse(dayKey, "yyyy-MM-dd", new Date());
}

/**
 * One draggable unit on the calendar: every post sharing a batch_id (the
 * unit updateScheduledTimeBatchAction reschedules together). Posts without
 * a batch_id become single-post batches keyed by the post id.
 */
export type CalendarBatch = {
  batchId: string;
  /** The batch's scheduled moment (first post's scheduled_at). */
  scheduledAtIso: string;
  status: BatchStatus;
  posts: ScheduledPostListItem[];
};

export function groupPostsIntoBatches(
  posts: readonly ScheduledPostListItem[],
): CalendarBatch[] {
  const postsByBatchId = new Map<string, ScheduledPostListItem[]>();
  for (const post of posts) {
    const batchKey = post.batch_id || post.id;
    const existingGroup = postsByBatchId.get(batchKey);
    if (existingGroup) {
      existingGroup.push(post);
    } else {
      postsByBatchId.set(batchKey, [post]);
    }
  }

  const batches: CalendarBatch[] = [];
  for (const [batchId, batchPosts] of postsByBatchId) {
    batches.push({
      batchId,
      scheduledAtIso: batchPosts[0].scheduled_at,
      status: summarizeBatchStatus(batchPosts.map((post) => post.status)),
      posts: batchPosts,
    });
  }

  batches.sort(
    (firstBatch, secondBatch) =>
      new Date(firstBatch.scheduledAtIso).getTime() -
      new Date(secondBatch.scheduledAtIso).getTime(),
  );
  return batches;
}

/**
 * Overlays in-flight drag moves onto server data so a dropped chip stays
 * where the user put it while the reschedule action round-trips.
 */
export function applyOptimisticMoves(
  batches: readonly CalendarBatch[],
  movesByBatchId: Readonly<Record<string, string>>,
): CalendarBatch[] {
  return batches.map((batch) => {
    const movedIso = movesByBatchId[batch.batchId];
    return movedIso ? { ...batch, scheduledAtIso: movedIso } : batch;
  });
}

export function groupBatchesByDay(
  batches: readonly CalendarBatch[],
): Map<string, CalendarBatch[]> {
  const batchesByDay = new Map<string, CalendarBatch[]>();
  for (const batch of batches) {
    const dayKey = formatDayKey(new Date(batch.scheduledAtIso));
    const dayBatches = batchesByDay.get(dayKey);
    if (dayBatches) {
      dayBatches.push(batch);
    } else {
      batchesByDay.set(dayKey, [batch]);
    }
  }
  return batchesByDay;
}

/** 42 consecutive days starting at the Monday on or before the 1st. */
export function buildMonthGridDays(anchor: Date): Date[] {
  const gridStart = startOfWeek(startOfMonth(anchor), {
    weekStartsOn: WEEK_STARTS_ON,
  });
  return eachDayOfInterval({
    start: gridStart,
    end: addDays(gridStart, MONTH_GRID_DAY_COUNT - 1),
  });
}

/** The 7 days of the week containing the anchor, Monday first. */
export function buildWeekDays(anchor: Date): Date[] {
  const weekStart = startOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON });
  return eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) });
}

/**
 * Only these statuses can move: updateScheduledTimeBatch reschedules
 * scheduled rows and auto-resumes cancelled ones; every other status is
 * terminal or in flight. sourceRef:
 * src/actions/server/scheduleActions/reschedule/updateScheduledTimeBatch.ts
 */
export function isBatchDraggable(batch: CalendarBatch): boolean {
  return batch.posts.some(
    (post) => post.status === "scheduled" || post.status === "cancelled",
  );
}

/** The dropped day at the batch's original local wall-clock time. */
export function combineDayWithTimeOf(dayKey: string, timeSource: Date): Date {
  const targetDay = parseDayKey(dayKey);
  return setSeconds(
    setMinutes(
      setHours(targetDay, timeSource.getHours()),
      timeSource.getMinutes(),
    ),
    0,
  );
}

/** The dropped day at the given hour, keeping the batch's minutes. */
export function combineDayWithHour(
  dayKey: string,
  hour: number,
  minutesSource: Date,
): Date {
  const targetDay = parseDayKey(dayKey);
  return setSeconds(
    setMinutes(setHours(targetDay, hour), minutesSource.getMinutes()),
    0,
  );
}

/** Droppable id helpers shared by the grids and the drop handler. */
export const DAY_DROPPABLE_PREFIX = "day-";
export const HOUR_DROPPABLE_PREFIX = "hour-";

export function buildDayDroppableId(dayKey: string): string {
  return `${DAY_DROPPABLE_PREFIX}${dayKey}`;
}

export function buildHourDroppableId(dayKey: string, hour: number): string {
  return `${HOUR_DROPPABLE_PREFIX}${dayKey}T${String(hour).padStart(2, "0")}`;
}

export type DropTarget =
  | { kind: "day"; dayKey: string }
  | { kind: "hour"; dayKey: string; hour: number };

export function parseDroppableId(droppableId: string): DropTarget | null {
  if (droppableId.startsWith(DAY_DROPPABLE_PREFIX)) {
    return { kind: "day", dayKey: droppableId.slice(DAY_DROPPABLE_PREFIX.length) };
  }
  if (droppableId.startsWith(HOUR_DROPPABLE_PREFIX)) {
    const dayAndHour = droppableId.slice(HOUR_DROPPABLE_PREFIX.length);
    const [dayKey, hourText] = dayAndHour.split("T");
    const hour = Number(hourText);
    if (!dayKey || Number.isNaN(hour)) return null;
    return { kind: "hour", dayKey, hour };
  }
  return null;
}

/** The prefilled create link a calendar slot points at. */
export function buildCreateLinkForSlot(dayKey: string, hour?: number): string {
  const time =
    hour === undefined ? "12:00" : `${String(hour).padStart(2, "0")}:00`;
  return `/create/text?date=${dayKey}&time=${time}`;
}
