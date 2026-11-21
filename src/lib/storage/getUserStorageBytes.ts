import "server-only";

import { sql } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { MEDIA_BUCKET } from "@/lib/storage/mediaBucket";

// postgres.js returns a bigint as a string by default:
// node_modules/postgres/README.md, "Numbers, bigint, numeric".
export async function getUserStorageBytes(
  principalId: string,
): Promise<
  | { success: true; currentBytes: number }
  | { success: false; message: string }
> {
  const { data: storageRows, error } = await runQuery(
    db.execute(
      sql`select public.get_user_storage_bytes(_bucket => ${MEDIA_BUCKET}, _prefix => ${`${principalId}/`}) as total_bytes`,
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
