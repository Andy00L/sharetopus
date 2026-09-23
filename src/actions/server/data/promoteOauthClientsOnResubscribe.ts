import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { mcp_oauth_clients } from "@/db/schema";

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
    const { data: existingVerified, error: countErr } = await runQuery(
      db.$count(
        mcp_oauth_clients,
        and(
          eq(mcp_oauth_clients.registered_by_user_id, principalId),
          eq(mcp_oauth_clients.trust_level, "verified"),
          isNull(mcp_oauth_clients.revoked_at),
        ),
      ),
    );

    if (countErr) {
      return {
        success: false,
        message: `[promoteOauthClientsOnResubscribe] Verified count failed: ${countErr.message}`,
      };
    }

    const slotsRemaining = MAX_VERIFIED_CLIENTS_PER_USER - existingVerified;

    if (slotsRemaining <= 0) {
      console.log(
        `[promoteOauthClientsOnResubscribe] No slots remaining for ${principalId} (already at ${existingVerified} verified)`
      );
      return { success: true, promoted: 0 };
    }

    const { data: candidates, error: fetchErr } = await runQuery(
      db
        .select({ client_id: mcp_oauth_clients.client_id })
        .from(mcp_oauth_clients)
        .where(
          and(
            eq(mcp_oauth_clients.registered_by_user_id, principalId),
            eq(mcp_oauth_clients.trust_level, "unverified"),
            isNull(mcp_oauth_clients.revoked_at),
          ),
        )
        .orderBy(asc(mcp_oauth_clients.created_at))
        .limit(slotsRemaining),
    );

    if (fetchErr) {
      return {
        success: false,
        message: `[promoteOauthClientsOnResubscribe] Candidate fetch failed: ${fetchErr.message}`,
      };
    }

    if (candidates.length === 0) {
      return { success: true, promoted: 0 };
    }

    const clientIds = candidates.map((candidate) => candidate.client_id);

    const { error: updateErr } = await runQuery(
      db
        .update(mcp_oauth_clients)
        .set({ trust_level: "verified" })
        .where(inArray(mcp_oauth_clients.client_id, clientIds)),
    );

    if (updateErr) {
      return {
        success: false,
        message: `[promoteOauthClientsOnResubscribe] Update failed: ${updateErr.message}`,
      };
    }

    console.log(
      `[promoteOauthClientsOnResubscribe] Promoted ${clientIds.length} clients for ${principalId}`
    );
    return { success: true, promoted: clientIds.length };
  } catch (err) {
    return {
      success: false,
      message: `[promoteOauthClientsOnResubscribe] Unexpected: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
