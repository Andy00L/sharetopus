"use server";

import { db, runQuery } from "@/db/client";
import { share_links } from "@/db/schema";
import { logX402Call } from "@/lib/x402/audit/logX402Call";
import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";

/**
 * Revokes a share link by setting revoked_at to now().
 *
 * Ownership-checked: only the creator who owns the link can revoke it.
 * Idempotent: revoking an already-revoked link returns success.
 * Does NOT disconnect existing social accounts linked via this share link.
 *
 * Called by: RevokeShareLinkButton client component
 * Tables touched: share_links (update)
 */

interface RevokeShareLinkInput {
  shareLinkId: string;
}

type RevokeShareLinkResult =
  | { success: true }
  | { success: false; message: string };

export async function revokeShareLink(
  input: RevokeShareLinkInput,
): Promise<RevokeShareLinkResult> {
  const startMs = performance.now();

  // 1. Auth
  const { userId } = await auth();
  if (!userId) {
    return { success: false, message: "Authentication required." };
  }

  if (!input.shareLinkId) {
    return { success: false, message: "Share link ID is required." };
  }

  // 2. Ownership check + revoke in one query
  //    WHERE owner_principal_id = userId ensures ownership.
  //    WHERE revoked_at IS NULL avoids re-revoking (idempotent: we still return success).
  const { error: updateError } = await runQuery(
    db
      .update(share_links)
      .set({ revoked_at: new Date().toISOString() })
      .where(
        and(
          eq(share_links.id, input.shareLinkId),
          eq(share_links.owner_principal_id, userId),
          isNull(share_links.revoked_at),
        ),
      ),
  );

  if (updateError) {
    console.error(
      `[revokeShareLink] Update failed for link ${input.shareLinkId}:`,
      updateError.message,
    );
    return { success: false, message: "Failed to revoke share link." };
  }

  // 3. Audit log (even if already revoked, for idempotent UI behavior)
  logX402Call({
    principal: null,
    action: "share_link.revoke",
    endpoint: "/actions/revokeShareLink",
    chargeId: null,
    resultStatus: "ok",
    latencyMs: Math.round(performance.now() - startMs),
  });

  // Idempotent: return success whether the row was updated or was already revoked
  return { success: true };
}
