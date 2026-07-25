"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { addMonths, addWeeks } from "date-fns";
import { CalendarDays } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { updateScheduledTimeBatchAction } from "@/actions/server/scheduleActions/reschedule/updateScheduledTimeBatchAction";
import type { ScheduledPostListItem } from "@/lib/types/dbTypes";
import BatchDetailDialog from "../BatchDetailDialog";
import {
  applyOptimisticMoves,
  combineDayWithHour,
  combineDayWithTimeOf,
  groupBatchesByDay,
  groupPostsIntoBatches,
  parseDayKey,
  parseDroppableId,
  type CalendarBatch,
  type CalendarView,
} from "./calendarMath";
import { BatchChipContent } from "./CalendarBatchChip";
import CalendarMonthGrid from "./CalendarMonthGrid";
import CalendarToolbar from "./CalendarToolbar";
import CalendarWeekGrid from "./CalendarWeekGrid";

/** Pixels a pointer must travel before a drag starts (clicks stay clicks). */
const DRAG_ACTIVATION_DISTANCE_PX = 6;

interface ScheduleCalendarProps {
  readonly posts: ScheduledPostListItem[];
  readonly userId: string;
}

/**
 * The drag-and-drop schedule calendar: month and week views over every
 * batch (including posted ones, shown in place). Dropping a chip calls the
 * same reschedule action the batch dialog uses, with the move applied
 * optimistically and reverted on failure. Data arrives from the server
 * page; after a successful move the RSC tree refreshes, and settled
 * optimistic entries are pruned against the fresh server rows.
 */
export default function ScheduleCalendar({
  posts,
  userId,
}: ScheduleCalendarProps) {
  const router = useRouter();

  const [view, setView] = useState<CalendarView>("month");
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string> | null>(
    null,
  );
  const [optimisticMoves, setOptimisticMoves] = useState<
    Record<string, string>
  >({});
  const [pendingBatchIds, setPendingBatchIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [dialogBatchId, setDialogBatchId] = useState<string | null>(null);
  const [activeDragBatch, setActiveDragBatch] = useState<CalendarBatch | null>(
    null,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX },
    }),
    useSensor(KeyboardSensor),
  );

  // Server truth, ungrouped by any filter: the pruning below must see every
  // batch even when a platform filter hides it from the grid.
  const serverBatches = groupPostsIntoBatches(posts);

  // Prune optimistic entries the server has caught up with (or whose batch
  // vanished), during render: the React "adjust state from props" pattern,
  // guarded so it only fires when something actually settled.
  const settledBatchIds = Object.keys(optimisticMoves).filter((batchId) => {
    if (pendingBatchIds.has(batchId)) return false;
    const serverBatch = serverBatches.find(
      (batch) => batch.batchId === batchId,
    );
    if (!serverBatch) return true;
    return (
      new Date(serverBatch.scheduledAtIso).getTime() ===
      new Date(optimisticMoves[batchId]).getTime()
    );
  });
  if (settledBatchIds.length > 0) {
    setOptimisticMoves((previousMoves) => {
      const nextMoves = { ...previousMoves };
      for (const batchId of settledBatchIds) {
        delete nextMoves[batchId];
      }
      return nextMoves;
    });
  }

  const availablePlatforms = [...new Set(posts.map((post) => post.platform))];

  const filteredPosts = selectedPlatforms
    ? posts.filter((post) => selectedPlatforms.has(post.platform))
    : posts;
  const visibleBatches = applyOptimisticMoves(
    groupPostsIntoBatches(filteredPosts),
    optimisticMoves,
  );
  const batchesByDay = groupBatchesByDay(visibleBatches);

  const dialogBatch = dialogBatchId
    ? visibleBatches.find((batch) => batch.batchId === dialogBatchId) ?? null
    : null;

  function handleNavigate(direction: "previous" | "today" | "next") {
    if (direction === "today") {
      setAnchor(new Date());
      return;
    }
    const step = direction === "next" ? 1 : -1;
    setAnchor((currentAnchor) =>
      view === "month"
        ? addMonths(currentAnchor, step)
        : addWeeks(currentAnchor, step),
    );
  }

  function handleTogglePlatform(platform: string) {
    setSelectedPlatforms((currentSelection) => {
      // No filter yet: checking one platform means "only this one".
      if (currentSelection === null) {
        return new Set([platform]);
      }
      const nextSelection = new Set(currentSelection);
      if (nextSelection.has(platform)) {
        nextSelection.delete(platform);
      } else {
        nextSelection.add(platform);
      }
      // Empty selection would show nothing forever; treat it as "all".
      return nextSelection.size === 0 ? null : nextSelection;
    });
  }

  function handleShowMore(dayKey: string) {
    setAnchor(parseDayKey(dayKey));
    setView("week");
  }

  function handleDragStart(event: DragStartEvent) {
    const draggedBatch = event.active.data.current?.batch as
      | CalendarBatch
      | undefined;
    setActiveDragBatch(draggedBatch ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const draggedBatch = activeDragBatch;
    setActiveDragBatch(null);

    if (!draggedBatch || !event.over) return;
    const dropTarget = parseDroppableId(String(event.over.id));
    if (!dropTarget) return;

    const currentScheduledAt = new Date(draggedBatch.scheduledAtIso);
    const targetDate =
      dropTarget.kind === "day"
        ? combineDayWithTimeOf(dropTarget.dayKey, currentScheduledAt)
        : combineDayWithHour(
            dropTarget.dayKey,
            dropTarget.hour,
            currentScheduledAt,
          );

    if (targetDate.getTime() === currentScheduledAt.getTime()) return;

    if (targetDate.getTime() <= Date.now()) {
      toast.error("That time has already passed. Pick a future slot.");
      return;
    }

    const batchId = draggedBatch.batchId;
    const targetIso = targetDate.toISOString();

    setOptimisticMoves((previousMoves) => ({
      ...previousMoves,
      [batchId]: targetIso,
    }));
    setPendingBatchIds((previousPending) =>
      new Set(previousPending).add(batchId),
    );

    const postIds = draggedBatch.posts.map((post) => post.id);
    updateScheduledTimeBatchAction(postIds, targetDate, userId)
      .then((result) => {
        if (result.success) {
          toast.success(result.message);
          router.refresh();
          return;
        }
        // Revert the move so the chip snaps back to the server truth.
        setOptimisticMoves((previousMoves) => {
          const nextMoves = { ...previousMoves };
          delete nextMoves[batchId];
          return nextMoves;
        });
        if (result.resetIn) {
          toast.error(
            `${result.message} Please try again in ${result.resetIn} seconds.`,
          );
        } else {
          toast.error(result.message);
        }
      })
      .catch(() => {
        setOptimisticMoves((previousMoves) => {
          const nextMoves = { ...previousMoves };
          delete nextMoves[batchId];
          return nextMoves;
        });
        toast.error("Unexpected error rescheduling. Please try again.");
      })
      .finally(() => {
        setPendingBatchIds((previousPending) => {
          const nextPending = new Set(previousPending);
          nextPending.delete(batchId);
          return nextPending;
        });
      });
  }

  return (
    <div className="flex flex-col gap-4">
      <CalendarToolbar
        view={view}
        anchor={anchor}
        availablePlatforms={availablePlatforms}
        selectedPlatforms={selectedPlatforms}
        onViewChange={setView}
        onNavigate={handleNavigate}
        onTogglePlatform={handleTogglePlatform}
        onClearPlatformFilter={() => setSelectedPlatforms(null)}
      />

      {posts.length === 0 && (
        <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
          <CalendarDays className="h-4 w-4" />
          Nothing scheduled yet. Hover any future day and click its + to plan
          your first post.
        </div>
      )}

      <DndContext
        id="schedule-calendar-dnd"
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDragBatch(null)}
      >
        {view === "month" ? (
          <CalendarMonthGrid
            anchor={anchor}
            batchesByDay={batchesByDay}
            pendingBatchIds={pendingBatchIds}
            onOpenBatch={setDialogBatchId}
            onShowMore={handleShowMore}
          />
        ) : (
          <CalendarWeekGrid
            anchor={anchor}
            batchesByDay={batchesByDay}
            pendingBatchIds={pendingBatchIds}
            onOpenBatch={setDialogBatchId}
          />
        )}

        <DragOverlay dropAnimation={null}>
          {activeDragBatch && (
            <BatchChipContent batch={activeDragBatch} lifted />
          )}
        </DragOverlay>
      </DndContext>

      {dialogBatch && (
        <BatchDetailDialog
          key={dialogBatch.batchId}
          posts={dialogBatch.posts}
          userId={userId}
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setDialogBatchId(null);
          }}
        />
      )}
    </div>
  );
}
