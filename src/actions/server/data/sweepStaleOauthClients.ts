import "server-only";
import { adminSupabase } from "@/actions/api/adminSupabase";

export type SweepResult =
  | {
      success: true;
      candidatesFound: number;
      deleted: number;
    }
  | {
      success: false;
      message: string;
    };

const STALE_DAYS = 90;
const MAX_DELETE_PER_RUN = 1000;

/**
 * Deletes OAuth client rows that are:
 *   - older than STALE_DAYS
 *   - trust_level = 'unverified'
 *   - not referenced by any mcp_session in the last STALE_DAYS
 *
 * Returns errors-as-values. Designed for Inngest step execution.
 */
export async function sweepStaleOauthClients(): Promise<SweepResult> {
  try {
    const cutoff = new Date(
      Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data: candidates, error: queryErr } = await adminSupabase
      .from("mcp_oauth_clients")
      .select("client_id")
      .eq("trust_level", "unverified")
      .lt("created_at", cutoff)
      .limit(MAX_DELETE_PER_RUN);

    if (queryErr) {
      return {
        success: false,
        message: `[sweepStaleOauthClients] Candidate query failed: ${queryErr.message}`,
      };
    }

    if (!candidates || candidates.length === 0) {
      return { success: true, candidatesFound: 0, deleted: 0 };
    }

    const candidateIds = candidates.map((c) => c.client_id);

    const { data: activeClients, error: sessionErr } = await adminSupabase
      .from("mcp_sessions")
      .select("oauth_client_id")
      .in("oauth_client_id", candidateIds)
      .gt("last_activity_at", cutoff)
      .not("oauth_client_id", "is", null);

    if (sessionErr) {
      return {
        success: false,
        message: `[sweepStaleOauthClients] Session query failed: ${sessionErr.message}`,
      };
    }

    const activeIds = new Set(
      (activeClients ?? [])
        .map((s) => s.oauth_client_id)
        .filter((id): id is string => id !== null)
    );

    const toDelete = candidateIds.filter((id) => !activeIds.has(id));

    if (toDelete.length === 0) {
      return {
        success: true,
        candidatesFound: candidates.length,
        deleted: 0,
      };
    }

    const { error: deleteErr } = await adminSupabase
      .from("mcp_oauth_clients")
      .delete()
      .in("client_id", toDelete);

    if (deleteErr) {
      return {
        success: false,
        message: `[sweepStaleOauthClients] Delete failed: ${deleteErr.message}`,
      };
    }

    console.log(
      `[sweepStaleOauthClients] Deleted ${toDelete.length}/${candidates.length} candidates`
    );

    return {
      success: true,
      candidatesFound: candidates.length,
      deleted: toDelete.length,
    };
  } catch (err) {
    return {
      success: false,
      message: `[sweepStaleOauthClients] Unexpected: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
