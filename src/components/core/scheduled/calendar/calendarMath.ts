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
  type Day,
} from "date-fns";

import type { PostStatus } from "@/db/schema";
import type { ScheduledPostListItem } from "@/lib/types/dbTypes";
import { summarizeBatchStatus, type BatchStatus } from "../statusStyles";

const MONDAY: Day = 1;
export const WEEK_STARTS_ON = MONDAY;

export type CalendarView = "month" | "week";

const WEEKS_IN_MONTH_GRID = 6;
const DAYS_PER_WEEK = 7;
const MONTH_GRID_DAY_COUNT = WEEKS_IN_MONTH_GRID * DAYS_PER_WEEK;

const RESCHEDULABLE_POST_STATUSES: readonly PostStatus[] = ["scheduled", "cancelled"];

export const ALL_PLATFORMS = null;
export type PlatformFilter = ReadonlySet<string> | typeof ALL_PLATFORMS;

export function formatDayKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function parseDayKey(dayKey: string): Date {
  return parse(dayKey, "yyyy-MM-dd", new Date());
}

export type CalendarBatch = {
  batchId: string;
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

export function buildMonthGridDays(anchor: Date): Date[] {
  const gridStart = startOfWeek(startOfMonth(anchor), {
    weekStartsOn: WEEK_STARTS_ON,
  });
  return eachDayOfInterval({
    start: gridStart,
    end: addDays(gridStart, MONTH_GRID_DAY_COUNT - 1),
  });
}

export function buildWeekDays(anchor: Date): Date[] {
  const weekStart = startOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON });
  return eachDayOfInterval({
    start: weekStart,
    end: addDays(weekStart, DAYS_PER_WEEK - 1),
  });
}

export function isBatchDraggable(batch: CalendarBatch): boolean {
  return batch.posts.some((post) =>
    RESCHEDULABLE_POST_STATUSES.includes(post.status),
  );
}

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

export function buildCreateLinkForSlot(dayKey: string, hour?: number): string {
  const time =
    hour === undefined ? "12:00" : `${String(hour).padStart(2, "0")}:00`;
  return `/create/text?date=${dayKey}&time=${time}`;
}
