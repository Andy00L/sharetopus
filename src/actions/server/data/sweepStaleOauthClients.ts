import "server-only";

import { and, eq, gt, inArray, lt } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { mcp_audit_log, mcp_oauth_clients } from "@/db/schema";
import { computeRetentionCutoff } from "@/lib/jobs/retention";

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

const MAX_DELETE_PER_RUN = 1000;

export async function sweepStaleOauthClients(): Promise<SweepResult> {
  try {
    const { cutoffIso: cutoff } = computeRetentionCutoff(new Date());

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
