import "server-only";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { STORAGE_LIMITS, DEFAULT_STORAGE_LIMIT } from "@/lib/types/plans";

const BUCKET = "scheduled-videos";

export type StorageQuotaOk = {
  success: true;
  currentBytes: number;
  capBytes: number;
};

export type StorageQuotaErr = {
  success: false;
  message: string;
  reason: "quota_exceeded" | "lookup_failed";
};

export type StorageQuotaResult = StorageQuotaOk | StorageQuotaErr;

/**
 * Checks whether adding `additionalBytes` to the principal's current
 * storage usage would exceed their plan's aggregate storage cap.
 *
 * Uses the `get_user_storage_bytes` Postgres RPC (reads storage.objects
 * directly) so the result is accurate regardless of file count.
 *
 * Returns errors as values. Never throws across this boundary.
 */
export async function enforceStorageQuota(
  principalId: string,
  priceId: string | null,
  additionalBytes: number,
): Promise<StorageQuotaResult> {
  const cap =
    priceId && STORAGE_LIMITS[priceId]
      ? STORAGE_LIMITS[priceId]
      : DEFAULT_STORAGE_LIMIT;

  const { data, error } = await adminSupabase.rpc("get_user_storage_bytes", {
    _bucket: BUCKET,
    _prefix: `${principalId}/`,
  });

  if (error) {
    console.error("[enforceStorageQuota] RPC failed:", error);
    return {
      success: false,
      message: "Failed to verify storage quota. Please retry.",
      reason: "lookup_failed",
    };
  }

  const currentBytes = Number(data ?? 0);
  const projected = currentBytes + additionalBytes;

  if (projected > cap) {
    const capGb = Math.round((cap / 1024 ** 3) * 10) / 10;
    const currentGb = Math.round((currentBytes / 1024 ** 3) * 100) / 100;
    return {
      success: false,
      message:
        `Storage quota exceeded. Plan cap: ${capGb} GB. ` +
        `Current usage: ${currentGb} GB. ` +
        `Cannot add ${Math.round(additionalBytes / 1024 ** 2)} MB. ` +
        `Delete scheduled posts to free space.`,
      reason: "quota_exceeded",
    };
  }

  return { success: true, currentBytes, capBytes: cap };
}
