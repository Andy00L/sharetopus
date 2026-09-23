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

/**
 * Days without a tool call before an unverified client is swept. Must not
 * exceed the mcp_audit_log retention, where recent activity is read from
 * (sourceRef: RETENTION_DAYS = 90 in
 * src/inngest/functions/cleanupMcpAuditLogCron.ts).
 */
const STALE_DAYS = 90;
const MAX_DELETE_PER_RUN = 1000;
/** Activity lookups in flight at once, to bound open connections. */
const ACTIVITY_CHECK_BATCH_SIZE = 20;

/**
 * Deletes OAuth client rows that are:
 *   - older than STALE_DAYS
 *   - trust_level = 'unverified'
 *   - without a tool call in mcp_audit_log in the last STALE_DAYS
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

    const candidateIds = candidates.map((candidate) => candidate.client_id);

    const activity = await findRecentlyActiveClientIds(candidateIds, cutoff);
    if (!activity.success) {
      return {
        success: false,
        message: `[sweepStaleOauthClients] ${activity.message}`,
      };
    }

    const toDelete = candidateIds.filter(
      (clientId) => !activity.activeIds.has(clientId)
    );

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

/**
 * Returns the candidates with at least one mcp_audit_log row after the
 * cutoff. One limit(1) lookup per candidate: a single IN query returns a
 * row per tool call, and PostgREST caps each response (1000 rows by
 * default), so one busy client could push the others out of the page and
 * get them deleted while still in use.
 */
async function findRecentlyActiveClientIds(
  candidateIds: string[],
  cutoff: string
): Promise<
  { success: true; activeIds: Set<string> } | { success: false; message: string }
> {
  const activeIds = new Set<string>();

  for (
    let batchStart = 0;
    batchStart < candidateIds.length;
    batchStart += ACTIVITY_CHECK_BATCH_SIZE
  ) {
    const batch = candidateIds.slice(
      batchStart,
      batchStart + ACTIVITY_CHECK_BATCH_SIZE
    );
    const lookups = await Promise.all(
      batch.map(async (clientId) => {
        const { data, error } = await adminSupabase
          .from("mcp_audit_log")
          .select("id")
          .eq("oauth_client_id", clientId)
          .gt("created_at", cutoff)
          .limit(1);
        return {
          clientId,
          hasRecentCall: (data?.length ?? 0) > 0,
          errorMessage: error?.message ?? null,
        };
      })
    );

    for (const lookup of lookups) {
      if (lookup.errorMessage !== null) {
        return {
          success: false,
          message: `Activity query failed for ${lookup.clientId}: ${lookup.errorMessage}`,
        };
      }
      if (lookup.hasRecentCall) activeIds.add(lookup.clientId);
    }
  }

  return { success: true, activeIds };
}
