import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";

const BUCKET = "scheduled-videos";

/**
 * Reads the total storage bytes for a principal from Supabase Storage.
 *
 * Wraps the `get_user_storage_bytes` Postgres RPC (reads storage.objects
 * directly), providing a single source of truth for storage metering
 * across both MCP/REST and x402 code paths.
 *
 * Returns errors as values. Never throws.
 */
export async function getUserStorageBytes(
  principalId: string,
): Promise<
  | { success: true; currentBytes: number }
  | { success: false; message: string }
> {
  const { data, error } = await adminSupabase.rpc("get_user_storage_bytes", {
    _bucket: BUCKET,
    _prefix: `${principalId}/`,
  });

  if (error) {
    console.error("[getUserStorageBytes] RPC failed:", error);
    return {
      success: false,
      message: "Failed to read storage usage. Please retry.",
    };
  }

  return { success: true, currentBytes: Number(data ?? 0) };
}
