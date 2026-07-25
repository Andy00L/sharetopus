"use client";

import { useRef } from "react";
import { useDroppable } from "@dnd-kit/core";
import { format, isBefore, isToday, setHours, startOfDay } from "date-fns";
import { Plus } from "lucide-react";
import Link from "next/link";

import { useNowTick } from "@/hooks/use-now-tick";
import type { CalendarBatch } from "./calendarMath";
import {
  buildCreateLinkForSlot,
  buildHourDroppableId,
  buildWeekDays,
  formatDayKey,
  isBatchDraggable,
} from "./calendarMath";
import CalendarBatchChip from "./CalendarBatchChip";

/** Hour the week view scrolls to on first paint (start of a workday). */
const INITIAL_SCROLL_HOUR = 7;

/** Minimum hour-row height in px; matches the min-h-12 cell class. */
const HOUR_ROW_MIN_PX = 48;

/** Now-line refresh cadence in ms (one minute keeps it visually honest). */
const NOW_TICK_INTERVAL_MS = 60_000;

const HOURS_OF_DAY = Array.from({ length: 24 }, (_, hourIndex) => hourIndex);

interface CalendarHourCellProps {
  readonly dayKey: string;
  readonly hour: number;
  readonly isPastHour: boolean;
  readonly showNowLine: boolean;
  readonly nowMinuteRatio: number;
  readonly batches: CalendarBatch[];
  readonly pendingBatchIds: ReadonlySet<string>;
  readonly onOpenBatch: (batchId: string) => void;
}

function CalendarHourCell({
  dayKey,
  hour,
  isPastHour,
  showNowLine,
  nowMinuteRatio,
  batches,
  pendingBatchIds,
  onOpenBatch,
}: CalendarHourCellProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: buildHourDroppableId(dayKey, hour),
    disabled: isPastHour,
    data: { dayKey, hour },
  });

  return (
    <div
      ref={setNodeRef}
      className={`group relative min-h-12 space-y-1 bg-card p-1 transition-colors duration-150 ${
        isPastHour ? "bg-muted/30" : ""
      } ${isOver && !isPastHour ? "bg-chart-1/5 ring-2 ring-inset ring-chart-1/50" : ""}`}
    >
      {showNowLine && (
        <div
          className="pointer-events-none absolute inset-x-0 z-10"
          style={{ top: `${nowMinuteRatio * 100}%` }}
          aria-hidden="true"
        >
          <div className="relative h-[2px] bg-chart-1">
            <span className="absolute -left-0.5 -top-[3px] h-2 w-2 rounded-full bg-chart-1" />
          </div>
        </div>
      )}

      {batches.map((batch) => (
        <CalendarBatchChip
          key={batch.batchId}
          batch={batch}
          draggable={isBatchDraggable(batch)}
          pending={pendingBatchIds.has(batch.batchId)}
          onOpen={onOpenBatch}
        />
      ))}

      {!isPastHour && batches.length === 0 && (
        <Link
          href={buildCreateLinkForSlot(dayKey, hour)}
          aria-label={`Schedule a post on ${dayKey} at ${hour}:00`}
          className="absolute right-1 top-1 rounded-md p-0.5 text-muted-foreground opacity-0 transition-opacity duration-150 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Plus className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}

interface CalendarWeekGridProps {
  readonly anchor: Date;
  readonly batchesByDay: ReadonlyMap<string, CalendarBatch[]>;
  readonly pendingBatchIds: ReadonlySet<string>;
  readonly onOpenBatch: (batchId: string) => void;
}

/**
 * The week view: seven day columns over 24 hour rows, each hour cell a
 * drop target that reschedules to that hour (minutes preserved). A
 * chart-1 now line marks the current minute in today's column.
 */
export default function CalendarWeekGrid({
  anchor,
  batchesByDay,
  pendingBatchIds,
  onOpenBatch,
}: CalendarWeekGridProps) {
  const now = useNowTick(NOW_TICK_INTERVAL_MS);
  const didInitialScrollRef = useRef(false);

  const weekDays = buildWeekDays(anchor);
  const todayStart = startOfDay(now);

  function scrollToWorkdayOnFirstPaint(scrollContainer: HTMLDivElement | null) {
    if (scrollContainer && !didInitialScrollRef.current) {
      scrollContainer.scrollTop = INITIAL_SCROLL_HOUR * HOUR_ROW_MIN_PX;
      didInitialScrollRef.current = true;
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-border">
      {/* Day header row */}
      <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] gap-px">
        <div className="bg-card" />
        {weekDays.map((day) => (
          <div
            key={formatDayKey(day)}
            className="flex items-center justify-center gap-1.5 bg-card px-1 py-1.5"
          >
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {format(day, "EEE")}
            </span>
            {isToday(day) ? (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-chart-1 text-[11px] font-semibold text-white">
                {format(day, "d")}
              </span>
            ) : (
              <span className="text-[11px] text-foreground">
                {format(day, "d")}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Hour rows */}
      <div
        ref={scrollToWorkdayOnFirstPaint}
        className="max-h-[65vh] overflow-y-auto"
      >
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] gap-px">
          {HOURS_OF_DAY.map((hour) => (
            <div key={hour} className="contents">
              <div className="flex min-h-12 items-start justify-end bg-card pr-1.5 pt-0.5">
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                  {format(setHours(now, hour), "h a")}
                </span>
              </div>
              {weekDays.map((day) => {
                const dayKey = formatDayKey(day);
                const isDayToday = isToday(day);
                const isPastDay = isBefore(day, todayStart);
                const isPastHour =
                  isPastDay || (isDayToday && hour < now.getHours());
                const dayBatches = batchesByDay.get(dayKey) ?? [];
                const hourBatches = dayBatches.filter(
                  (batch) =>
                    new Date(batch.scheduledAtIso).getHours() === hour,
                );
                return (
                  <CalendarHourCell
                    key={`${dayKey}-${hour}`}
                    dayKey={dayKey}
                    hour={hour}
                    isPastHour={isPastHour}
                    showNowLine={isDayToday && hour === now.getHours()}
                    nowMinuteRatio={now.getMinutes() / 60}
                    batches={hourBatches}
                    pendingBatchIds={pendingBatchIds}
                    onOpenBatch={onOpenBatch}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
