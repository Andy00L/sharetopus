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
  ALL_PLATFORMS,
  applyOptimisticMoves,
  combineDayWithHour,
  combineDayWithTimeOf,
  groupBatchesByDay,
  groupPostsIntoBatches,
  parseDayKey,
  parseDroppableId,
  type CalendarBatch,
  type CalendarView,
  type PlatformFilter,
} from "./calendarMath";
import { BatchChipContent } from "./CalendarBatchChip";
import CalendarMonthGrid from "./CalendarMonthGrid";
import CalendarToolbar from "./CalendarToolbar";
import CalendarWeekGrid from "./CalendarWeekGrid";

const DRAG_ACTIVATION_DISTANCE_PX = 6;

interface ScheduleCalendarProps {
  readonly posts: ScheduledPostListItem[];
  readonly userId: string;
}

export default function ScheduleCalendar({
  posts,
  userId,
}: ScheduleCalendarProps) {
  const router = useRouter();

  const [view, setView] = useState<CalendarView>("month");
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [selectedPlatforms, setSelectedPlatforms] =
    useState<PlatformFilter>(ALL_PLATFORMS);
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

  const unfilteredServerBatches = groupPostsIntoBatches(posts);

  // State adjusted during render, guarded so it cannot loop (React rule:
  // react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const settledBatchIds = Object.keys(optimisticMoves).filter((batchId) => {
    if (pendingBatchIds.has(batchId)) return false;
    const serverBatch = unfilteredServerBatches.find(
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
      if (currentSelection === ALL_PLATFORMS) {
        return new Set([platform]);
      }
      const nextSelection = new Set(currentSelection);
      if (nextSelection.has(platform)) {
        nextSelection.delete(platform);
      } else {
        nextSelection.add(platform);
      }
      return nextSelection.size === 0 ? ALL_PLATFORMS : nextSelection;
    });
  }

  function handleShowMore(dayKey: string) {
    setAnchor(parseDayKey(dayKey));
    setView("week");
  }

  function handleDragStart(event: DragStartEvent) {
    const draggedBatch = visibleBatches.find(
      (batch) => batch.batchId === event.active.id,
    );
    setActiveDragBatch(draggedBatch ?? null);
  }

  function revertOptimisticMove(batchId: string) {
    setOptimisticMoves((previousMoves) => {
      const nextMoves = { ...previousMoves };
      delete nextMoves[batchId];
      return nextMoves;
    });
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
        revertOptimisticMove(batchId);
        if (result.resetIn) {
          toast.error(
            `${result.message} Please try again in ${result.resetIn} seconds.`,
          );
        } else {
          toast.error(result.message);
        }
      })
      .catch(() => {
        revertOptimisticMove(batchId);
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
        onClearPlatformFilter={() => setSelectedPlatforms(ALL_PLATFORMS)}
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
            <BatchChipContent batch={activeDragBatch} isDragOverlay />
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
