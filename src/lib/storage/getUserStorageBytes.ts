import "server-only";

import { sql } from "drizzle-orm";

import { db, runQuery } from "@/db/client";

const BUCKET = "scheduled-videos";

/**
 * Reads the total storage bytes for a principal from Supabase Storage.
 *
 * Wraps the `get_user_storage_bytes(_bucket text, _prefix text)` Postgres
 * function (reads storage.objects directly), providing a single source of
 * truth for storage metering across both MCP/REST and x402 code paths.
 *
 * The function returns bigint, which db.execute hands back as a string;
 * a NULL total (nothing stored) counts as 0 bytes.
 *
 * Returns errors as values. Never throws.
 */
export async function getUserStorageBytes(
  principalId: string,
): Promise<
  | { success: true; currentBytes: number }
  | { success: false; message: string }
> {
  const { data: storageRows, error } = await runQuery(
    db.execute(
      sql`select public.get_user_storage_bytes(_bucket => ${BUCKET}, _prefix => ${`${principalId}/`}) as total_bytes`,
    ),
  );

  if (error) {
    console.error("[getUserStorageBytes] RPC failed:", error);
    return {
      success: false,
      message: "Failed to read storage usage. Please retry.",
    };
  }

  const totalBytes: unknown = storageRows[0]?.total_bytes ?? 0;
  const currentBytes =
    typeof totalBytes === "string" || typeof totalBytes === "number"
      ? Number(totalBytes)
      : Number.NaN;
  if (!Number.isFinite(currentBytes)) {
    console.error(
      "[getUserStorageBytes] RPC returned a non-numeric total:",
      totalBytes,
    );
    return {
      success: false,
      message: "Failed to read storage usage. Please retry.",
    };
  }

  return { success: true, currentBytes };
}
