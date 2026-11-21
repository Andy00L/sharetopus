import type { PlatformFailureReason } from "@/lib/api/_shared/platformFailure";

export type StorageReadFailureReason = "not_found" | "unavailable";

export const STORAGE_READ_TIMEOUT_MS = 60_000;

type StorageErrorStatus = { status: number | undefined; statusCode: string | undefined };

const NOT_FOUND_HTTP_STATUS = 404;
const NOT_FOUND_STATUS_CODE = String(NOT_FOUND_HTTP_STATUS);

// storage-js copies the answer's HTTP status to `status` and the JSON body's
// `statusCode` to `statusCode`; Supabase Storage reports a missing object as
// statusCode "404", on an HTTP 404 or 400 answer depending on the server version.
export function classifyStorageReadError(error: StorageErrorStatus): StorageReadFailureReason {
  const isMissingObject =
    error.status === NOT_FOUND_HTTP_STATUS || error.statusCode === NOT_FOUND_STATUS_CODE;
  return isMissingObject ? "not_found" : "unavailable";
}

export function toPublishFailureReason(
  reason: StorageReadFailureReason,
): Extract<PlatformFailureReason, "invalid_input" | "transient"> {
  return reason === "not_found" ? "invalid_input" : "transient";
}
