import type { PostStatus } from "@/db/schema";

export type BatchStatus = PostStatus | "mixed";

export type PostStatusStyle = {
  label: string;
  textClass: string;
  borderClass: string;
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

export function summarizeBatchStatus(statuses: readonly string[]): BatchStatus {
  const uniqueStatuses = [...new Set(statuses)];
  if (uniqueStatuses.length === 1 && isKnownBatchStatus(uniqueStatuses[0])) {
    return uniqueStatuses[0];
  }
  return "mixed";
}
