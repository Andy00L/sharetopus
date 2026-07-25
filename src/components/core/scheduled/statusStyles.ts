import type { PostStatus } from "@/lib/types/database.types";

/**
 * One canonical style per post status, shared by the batch card badge, the
 * calendar chips, and the calendar legend so a status always reads as the
 * same color everywhere. "mixed" is the synthetic value a batch reports
 * when its posts disagree. Color values reuse the palette the status badge
 * already shipped with (BatchedPostCard), extended with "queued" which the
 * DB has but the badge never rendered.
 */
export type BatchStatus = PostStatus | "mixed";

export type PostStatusStyle = {
  label: string;
  /** Badge text + icon color. */
  textClass: string;
  /** Badge outline color. */
  borderClass: string;
  /** Solid marker used by calendar chips and the legend. */
  dotClass: string;
};

export const POST_STATUS_STYLES: Record<BatchStatus, PostStatusStyle> = {
  scheduled: {
    label: "Scheduled",
    textClass: "text-blue-500",
    borderClass: "border-blue-200",
    dotClass: "bg-blue-500",
  },
  queued: {
    label: "Queued",
    textClass: "text-sky-500",
    borderClass: "border-sky-200",
    dotClass: "bg-sky-500",
  },
  processing: {
    label: "Processing",
    textClass: "text-yellow-500",
    borderClass: "border-yellow-200",
    dotClass: "bg-yellow-500",
  },
  posted: {
    label: "Posted",
    textClass: "text-green-500",
    borderClass: "border-green-200",
    dotClass: "bg-green-500",
  },
  failed: {
    label: "Failed",
    textClass: "text-red-500",
    borderClass: "border-red-200",
    dotClass: "bg-red-500",
  },
  cancelled: {
    label: "Cancelled",
    textClass: "text-gray-500",
    borderClass: "border-gray-200",
    dotClass: "bg-gray-400",
  },
  mixed: {
    label: "Mixed Status",
    textClass: "text-purple-500",
    borderClass: "border-purple-200",
    dotClass: "bg-purple-500",
  },
};

export function isKnownBatchStatus(value: string): value is BatchStatus {
  return value in POST_STATUS_STYLES;
}

/** A batch's single display status: its posts' shared status, or "mixed". */
export function summarizeBatchStatus(statuses: readonly string[]): BatchStatus {
  const uniqueStatuses = [...new Set(statuses)];
  if (uniqueStatuses.length === 1 && isKnownBatchStatus(uniqueStatuses[0])) {
    return uniqueStatuses[0];
  }
  return "mixed";
}
