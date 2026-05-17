import "server-only";
import { getUserStorageBytes } from "@/lib/storage/getUserStorageBytes";
import { TIER_STORAGE_LIMITS, DEFAULT_STORAGE_LIMIT, type PlanTier } from "@/lib/types/plans";

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
 * Uses getUserStorageBytes (wraps the `get_user_storage_bytes` RPC)
 * so the result is accurate regardless of file count.
 *
 * Returns errors as values. Never throws across this boundary.
 */
export async function enforceStorageQuota(
  principalId: string,
  tier: PlanTier | null,
  additionalBytes: number,
): Promise<StorageQuotaResult> {
  const cap = tier !== null
    ? TIER_STORAGE_LIMITS[tier]
    : DEFAULT_STORAGE_LIMIT;

  const storageResult = await getUserStorageBytes(principalId);

  if (!storageResult.success) {
    return {
      success: false,
      message: storageResult.message,
      reason: "lookup_failed",
    };
  }

  const currentBytes = storageResult.currentBytes;
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
