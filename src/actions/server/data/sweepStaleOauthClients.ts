import "server-only";

import { and, eq, gt, inArray, lt } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { mcp_audit_log, mcp_oauth_clients } from "@/db/schema";

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

    const { data: candidates, error: queryErr } = await runQuery(
      db
        .select({ client_id: mcp_oauth_clients.client_id })
        .from(mcp_oauth_clients)
        .where(
          and(
            eq(mcp_oauth_clients.trust_level, "unverified"),
            lt(mcp_oauth_clients.created_at, cutoff),
          ),
        )
        .limit(MAX_DELETE_PER_RUN),
    );

    if (queryErr) {
      return {
        success: false,
        message: `[sweepStaleOauthClients] Candidate query failed: ${queryErr.message}`,
      };
    }

    if (candidates.length === 0) {
      return { success: true, candidatesFound: 0, deleted: 0 };
    }

    const candidateIds = candidates.map((candidate) => candidate.client_id);

    // One DISTINCT query answers "which candidates made a call since the
    // cutoff", whatever the number of calls per client.
    const { data: activeRows, error: activityErr } = await runQuery(
      db
        .selectDistinct({ oauth_client_id: mcp_audit_log.oauth_client_id })
        .from(mcp_audit_log)
        .where(
          and(
            inArray(mcp_audit_log.oauth_client_id, candidateIds),
            gt(mcp_audit_log.created_at, cutoff),
          ),
        ),
    );

    if (activityErr) {
      return {
        success: false,
        message: `[sweepStaleOauthClients] Activity query failed: ${activityErr.message}`,
      };
    }

    const activeIds = new Set(
      activeRows.map((activeRow) => activeRow.oauth_client_id),
    );
    const toDelete = candidateIds.filter(
      (clientId) => !activeIds.has(clientId)
    );

    if (toDelete.length === 0) {
      return {
        success: true,
        candidatesFound: candidates.length,
        deleted: 0,
      };
    }

    const { error: deleteErr } = await runQuery(
      db
        .delete(mcp_oauth_clients)
        .where(inArray(mcp_oauth_clients.client_id, toDelete)),
    );

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
