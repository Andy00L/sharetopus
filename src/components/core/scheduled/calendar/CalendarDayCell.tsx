"use client";

import { useDroppable } from "@dnd-kit/core";
import { format } from "date-fns";
import { Plus } from "lucide-react";
import Link from "next/link";

import type { CalendarBatch } from "./calendarMath";
import {
  buildCreateLinkForSlot,
  buildDayDroppableId,
  isBatchDraggable,
} from "./calendarMath";
import CalendarBatchChip from "./CalendarBatchChip";

/** Chips shown per month cell before collapsing into "+N more". */
const MAX_VISIBLE_BATCHES_PER_DAY = 3;

interface CalendarDayCellProps {
  readonly day: Date;
  readonly dayKey: string;
  readonly isInAnchorMonth: boolean;
  readonly isToday: boolean;
  /** Past days reject drops and hide the quick-create link. */
  readonly isPast: boolean;
  readonly batches: CalendarBatch[];
  readonly pendingBatchIds: ReadonlySet<string>;
  readonly onOpenBatch: (batchId: string) => void;
  readonly onShowMore: (dayKey: string) => void;
}

/**
 * One day of the month grid: a drop target for chip drags, a quick-create
 * entry ("+" on hover, prefills the composer with this date), and up to
 * three chips with a "+N more" overflow that jumps to the week view.
 */
export default function CalendarDayCell({
  day,
  dayKey,
  isInAnchorMonth,
  isToday,
  isPast,
  batches,
  pendingBatchIds,
  onOpenBatch,
  onShowMore,
}: CalendarDayCellProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: buildDayDroppableId(dayKey),
    disabled: isPast,
    data: { dayKey },
  });

  const visibleBatches = batches.slice(0, MAX_VISIBLE_BATCHES_PER_DAY);
  const hiddenBatchCount = batches.length - visibleBatches.length;

  return (
    <div
      ref={setNodeRef}
      className={`group relative flex min-h-28 flex-col gap-1 p-1.5 transition-colors duration-150 ${
        isInAnchorMonth ? "bg-card" : "bg-muted/40"
      } ${isOver && !isPast ? "bg-chart-1/5 ring-2 ring-inset ring-chart-1/50" : ""}`}
      aria-label={format(day, "EEEE, MMMM d")}
    >
      <div className="flex items-center justify-between">
        {isToday ? (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-chart-1 text-xs font-semibold text-white">
            {format(day, "d")}
          </span>
        ) : (
          <span
            className={`flex h-6 w-6 items-center justify-center text-xs ${
              isInAnchorMonth
                ? "text-foreground"
                : "text-muted-foreground/60"
            }`}
          >
            {format(day, "d")}
          </span>
        )}

        {!isPast && (
          <Link
            href={buildCreateLinkForSlot(dayKey)}
            aria-label={`Schedule a post on ${format(day, "MMMM d")}`}
            className="rounded-md p-0.5 text-muted-foreground opacity-0 transition-opacity duration-150 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Plus className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      {visibleBatches.map((batch) => (
        <CalendarBatchChip
          key={batch.batchId}
          batch={batch}
          draggable={isBatchDraggable(batch)}
          pending={pendingBatchIds.has(batch.batchId)}
          onOpen={onOpenBatch}
        />
      ))}

      {hiddenBatchCount > 0 && (
        <button
          type="button"
          onClick={() => onShowMore(dayKey)}
          className="rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
        >
          +{hiddenBatchCount} more
        </button>
      )}
    </div>
  );
}
