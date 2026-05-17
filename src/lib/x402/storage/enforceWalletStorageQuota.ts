import "server-only";

import { getUserStorageBytes } from "@/lib/storage/getUserStorageBytes";
import { WALLET_STORAGE_LIMIT } from "@/lib/types/plans";

/**
 * Enforces the aggregate storage cap for x402 wallet users.
 *
 * Steps:
 * 1. Read current storage usage via getUserStorageBytes RPC.
 * 2. Project usage after additionalBytes.
 * 3. Compare against WALLET_STORAGE_LIMIT (5 GB, independent constant).
 * 4. Return allowed/denied with byte-level details for the caller.
 *
 * Wallet routes call this function (not the MCP enforceStorageQuota).
 * Returns errors as values. Never throws.
 */
export async function enforceWalletStorageQuota(
  walletPrincipalId: string,
  additionalBytes: number,
): Promise<
  | { allowed: true; currentBytes: number; projectedBytes: number; capBytes: number }
  | { allowed: false; currentBytes: number; projectedBytes: number; capBytes: number; message: string }
> {
  const storageResult = await getUserStorageBytes(walletPrincipalId);

  if (!storageResult.success) {
    // Fail closed: deny upload if we cannot read current usage.
    return {
      allowed: false,
      currentBytes: 0,
      projectedBytes: additionalBytes,
      capBytes: WALLET_STORAGE_LIMIT,
      message: storageResult.message,
    };
  }

  const currentBytes = storageResult.currentBytes;
  const projectedBytes = currentBytes + additionalBytes;
  const capBytes = WALLET_STORAGE_LIMIT;

  if (projectedBytes > capBytes) {
    const capGb = Math.round((capBytes / 1024 ** 3) * 10) / 10;
    const currentGb = Math.round((currentBytes / 1024 ** 3) * 100) / 100;
    const additionalMb = Math.round(additionalBytes / 1024 ** 2);
    return {
      allowed: false,
      currentBytes,
      projectedBytes,
      capBytes,
      message:
        `Storage quota exceeded. Wallet cap: ${capGb} GB. ` +
        `Current usage: ${currentGb} GB. ` +
        `Cannot add ${additionalMb} MB. ` +
        `Delete media to free space.`,
    };
  }

  return { allowed: true, currentBytes, projectedBytes, capBytes };
}
