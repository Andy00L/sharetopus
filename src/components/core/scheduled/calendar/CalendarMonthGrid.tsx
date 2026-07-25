"use client";

import { format, isBefore, isSameMonth, isToday, startOfDay } from "date-fns";

import type { CalendarBatch } from "./calendarMath";
import { buildMonthGridDays, buildWeekDays, formatDayKey } from "./calendarMath";
import CalendarDayCell from "./CalendarDayCell";

interface CalendarMonthGridProps {
  readonly anchor: Date;
  readonly batchesByDay: ReadonlyMap<string, CalendarBatch[]>;
  readonly pendingBatchIds: ReadonlySet<string>;
  readonly onOpenBatch: (batchId: string) => void;
  readonly onShowMore: (dayKey: string) => void;
}

/**
 * The month view: a hairline 7x6 grid of drop-target day cells. The grid
 * lines come from a 1px border-token gap, the app's one hairline material.
 */
export default function CalendarMonthGrid({
  anchor,
  batchesByDay,
  pendingBatchIds,
  onOpenBatch,
  onShowMore,
}: CalendarMonthGridProps) {
  const gridDays = buildMonthGridDays(anchor);
  const weekdayLabels = buildWeekDays(anchor).map((day) => format(day, "EEE"));
  const todayStart = startOfDay(new Date());

  return (
    <div className="overflow-hidden rounded-xl border bg-border">
      <div className="grid grid-cols-7 gap-px">
        {weekdayLabels.map((label) => (
          <div
            key={label}
            className="bg-card px-2 py-1.5 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            {label}
          </div>
        ))}
        {gridDays.map((day) => {
          const dayKey = formatDayKey(day);
          return (
            <CalendarDayCell
              key={dayKey}
              day={day}
              dayKey={dayKey}
              isInAnchorMonth={isSameMonth(day, anchor)}
              isToday={isToday(day)}
              isPast={isBefore(day, todayStart)}
              batches={batchesByDay.get(dayKey) ?? []}
              pendingBatchIds={pendingBatchIds}
              onOpenBatch={onOpenBatch}
              onShowMore={onShowMore}
            />
          );
        })}
      </div>
    </div>
  );
}
