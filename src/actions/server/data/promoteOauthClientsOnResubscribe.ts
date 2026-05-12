import "server-only";
import { adminSupabase } from "@/actions/api/adminSupabase";

export type PromoteResult =
  | { success: true; promoted: number }
  | { success: false; message: string };

const MAX_VERIFIED_CLIENTS_PER_USER = 5;

/**
 * Mirror of demoteOauthClientsOnCancel.
 *
 * Promotes the user's unverified OAuth clients back to verified, up to
 * the per-user cap. Clients are selected in order of `created_at ASC`
 * (oldest first) so the user's earliest registrations get priority.
 *
 * Only touches clients with `revoked_at IS NULL` and trust_level
 * 'unverified'. Blocked clients are NEVER auto-promoted (admin
 * intervention required).
 *
 * Idempotent: re-running with no new clients to promote returns
 * { success: true, promoted: 0 }.
 */
export async function promoteOauthClientsOnResubscribe(
  principalId: string
): Promise<PromoteResult> {
  try {
    const { count: existingVerified, error: countErr } = await adminSupabase
      .from("mcp_oauth_clients")
      .select("client_id", { count: "exact", head: true })
      .eq("registered_by_user_id", principalId)
      .eq("trust_level", "verified")
      .is("revoked_at", null);

    if (countErr) {
      return {
        success: false,
        message: `[promoteOauthClientsOnResubscribe] Verified count failed: ${countErr.message}`,
      };
    }

    const slotsRemaining =
      MAX_VERIFIED_CLIENTS_PER_USER - (existingVerified ?? 0);

    if (slotsRemaining <= 0) {
      console.log(
        `[promoteOauthClientsOnResubscribe] No slots remaining for ${principalId} (already at ${existingVerified} verified)`
      );
      return { success: true, promoted: 0 };
    }

    const { data: candidates, error: fetchErr } = await adminSupabase
      .from("mcp_oauth_clients")
      .select("client_id")
      .eq("registered_by_user_id", principalId)
      .eq("trust_level", "unverified")
      .is("revoked_at", null)
      .order("created_at", { ascending: true })
      .limit(slotsRemaining);

    if (fetchErr) {
      return {
        success: false,
        message: `[promoteOauthClientsOnResubscribe] Candidate fetch failed: ${fetchErr.message}`,
      };
    }

    if (!candidates || candidates.length === 0) {
      return { success: true, promoted: 0 };
    }

    const ids = candidates.map((c) => c.client_id);

    const { error: updateErr } = await adminSupabase
      .from("mcp_oauth_clients")
      .update({ trust_level: "verified" })
      .in("client_id", ids);

    if (updateErr) {
      return {
        success: false,
        message: `[promoteOauthClientsOnResubscribe] Update failed: ${updateErr.message}`,
      };
    }

    console.log(
      `[promoteOauthClientsOnResubscribe] Promoted ${ids.length} clients for ${principalId}`
    );
    return { success: true, promoted: ids.length };
  } catch (err) {
    return {
      success: false,
      message: `[promoteOauthClientsOnResubscribe] Unexpected: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
