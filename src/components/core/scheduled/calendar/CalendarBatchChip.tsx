"use client";

import { useDraggable } from "@dnd-kit/core";
import { format } from "date-fns";

import SocialAvatarWrapper from "@/components/SocialAvatarWrapper";
import { POST_STATUS_STYLES } from "../statusStyles";
import type { CalendarBatch } from "./calendarMath";

/** Avatars shown on a chip before collapsing into a "+N" counter. */
const MAX_CHIP_AVATARS = 3;

interface BatchChipContentProps {
  readonly batch: CalendarBatch;
  /** Lifted style for the drag overlay clone. */
  readonly lifted?: boolean;
}

/**
 * The visual body of a calendar chip, shared by the in-grid draggable and
 * the DragOverlay clone so the lifted copy matches pixel for pixel.
 */
export function BatchChipContent({ batch, lifted = false }: BatchChipContentProps) {
  const statusStyle = POST_STATUS_STYLES[batch.status];
  const scheduledAt = new Date(batch.scheduledAtIso);
  const firstPost = batch.posts[0];
  const snippet =
    firstPost.post_title ||
    firstPost.post_description ||
    `${firstPost.media_type} post`;

  const visibleAvatarPosts = batch.posts.slice(0, MAX_CHIP_AVATARS);
  const hiddenAvatarCount = batch.posts.length - visibleAvatarPosts.length;

  return (
    <div
      className={`w-full rounded-lg border bg-card px-1.5 py-1 text-left transition-shadow duration-150 ${
        lifted ? "shadow-lg ring-1 ring-chart-1/40" : "shadow-sm"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${statusStyle.dotClass}`}
          aria-hidden="true"
        />
        <span className="font-mono text-[10px] font-medium text-muted-foreground tabular-nums">
          {format(scheduledAt, "h:mm a")}
        </span>
        <div className="ml-auto flex items-center -space-x-2">
          {visibleAvatarPosts.map((post) => (
            <SocialAvatarWrapper
              key={post.id}
              src={post.social_accounts?.avatar_url}
              alt={`${post.platform} account`}
              platform={post.platform}
              className="h-5 w-5"
              size={20}
            />
          ))}
          {hiddenAvatarCount > 0 && (
            <span className="z-10 flex h-5 w-5 items-center justify-center rounded-full border bg-muted font-mono text-[9px] text-muted-foreground">
              +{hiddenAvatarCount}
            </span>
          )}
        </div>
      </div>
      <p className="mt-0.5 truncate text-[11px] leading-tight text-foreground">
        {snippet}
      </p>
    </div>
  );
}

interface CalendarBatchChipProps {
  readonly batch: CalendarBatch;
  readonly draggable: boolean;
  /** True while this batch's reschedule action is round-tripping. */
  readonly pending: boolean;
  readonly onOpen: (batchId: string) => void;
}

/**
 * One scheduled batch on the calendar grid. Dragging it reschedules the
 * whole batch; a plain click opens the shared batch detail dialog (the
 * pointer sensor's distance constraint tells the two apart).
 */
export default function CalendarBatchChip({
  batch,
  draggable,
  pending,
  onOpen,
}: CalendarBatchChipProps) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: batch.batchId,
    disabled: !draggable,
    data: { batch },
  });

  const statusStyle = POST_STATUS_STYLES[batch.status];
  const timeLabel = format(new Date(batch.scheduledAtIso), "h:mm a");

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onOpen(batch.batchId)}
      aria-label={`${batch.posts.length} post batch at ${timeLabel}, ${statusStyle.label}${
        draggable ? ". Drag to reschedule" : ""
      }`}
      title={
        draggable
          ? "Drag to reschedule, click for details"
          : `${statusStyle.label} posts cannot be moved`
      }
      className={`block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg ${
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      } ${isDragging ? "opacity-40" : ""} ${pending ? "animate-pulse opacity-70" : ""}`}
      {...listeners}
      {...attributes}
    >
      <BatchChipContent batch={batch} />
    </button>
  );
}
