"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { logX402Call } from "@/lib/x402/audit/logX402Call";
import { auth } from "@clerk/nextjs/server";

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
  const { data: updatedRow, error: updateError } = await adminSupabase
    .from("share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", input.shareLinkId)
    .eq("owner_principal_id", userId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

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
