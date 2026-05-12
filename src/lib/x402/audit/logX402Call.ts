import "server-only";

/**
 * Audit logger for x402 access. Mirror of src/lib/mcp/audit.ts logToolCall,
 * but writes to x402_access_log instead of mcp_audit_log.
 *
 * Key difference from logToolCall: x402 audit is endpoint-grained, not
 * args-grained. There is no args_redacted column on x402_access_log.
 * Phase 4.6 may add an args column if observability needs it; not in scope.
 *
 * Same threat model as logToolCall: fire-and-forget, errors caught and logged
 * (never propagated), append-only table with UPDATE-blocking trigger.
 *
 * Called by: every x402 route handler (Phase 4.1+)
 * Tables touched: x402_access_log (insert only)
 *
 * IP hashing: callers compute ipHash via extractIpHash from @/lib/mcp/context
 * (which uses hashClientIp from @/lib/mcp/ipHash) and pass it as a field.
 * This function does not import the hash helpers directly.
 */

import { adminSupabase } from "@/actions/api/adminSupabase";
import type { WalletPrincipal } from "@/lib/x402/auth/types";

/** Max User-Agent length stored. Matches mcp_audit_log column behavior. */
const MAX_USER_AGENT_LENGTH = 512;

export interface X402AuditEntry {
  /** Resolved wallet principal, or null if the request failed pre-resolve. */
  principal: WalletPrincipal | null;

  /** Pricing action key (matches pricing_actions.action). Null if pre-payment. */
  action: string | null;

  /** The HTTP endpoint path that was hit (e.g., "/api/x402/register"). */
  endpoint: string;

  /** x402_charges.id. Null when the request never reached settlement. */
  chargeId: string | null;

  /** Outcome of the request. Maps 1:1 to x402_access_log.result_status CHECK. */
  resultStatus: "ok" | "402_required" | "sanctioned" | "rate_limited" | "error";

  /** Server-side request latency in ms. */
  latencyMs?: number;

  /** SHA-256 hash of the client IP. Use extractIpHash from @/lib/mcp/context. */
  ipHash?: string | null;

  /** Raw User-Agent header (truncated to 512 chars on insert). */
  userAgent?: string | null;
}

/**
 * Appends a row to x402_access_log. Fire-and-forget; the table has an
 * UPDATE-blocking trigger so writes are truly append-only.
 *
 * Mirrors src/lib/mcp/audit.ts logToolCall in behavior and shape, but
 * writes to a different table and uses a smaller entry type (no oauth client,
 * no api key, no session id since x402 is stateless per call).
 *
 * Failure modes: errors are caught and logged, never propagated. A broken
 * audit row should not affect the user response.
 */
export async function logX402Call(entry: X402AuditEntry): Promise<void> {
  try {
    const truncatedUserAgent =
      entry.userAgent && entry.userAgent.length > MAX_USER_AGENT_LENGTH
        ? entry.userAgent.slice(0, MAX_USER_AGENT_LENGTH)
        : entry.userAgent ?? null;

    const { error } = await adminSupabase.from("x402_access_log").insert({
      principal_id: entry.principal?.principalId ?? null,
      wallet_id: entry.principal?.walletId ?? null,
      endpoint: entry.endpoint,
      action: entry.action,
      charge_id: entry.chargeId,
      result_status: entry.resultStatus,
      latency_ms: entry.latencyMs ?? null,
      ip_hash: entry.ipHash ?? null,
      user_agent: truncatedUserAgent,
      // Do NOT pass `month` (GENERATED column).
      // Do NOT pass `created_at` (defaults to now()).
    });

    if (error) {
      console.error(`[logX402Call] Failed to insert audit row for ${entry.endpoint}: ${error.message}`);
    }
  } catch (err) {
    console.error(`[logX402Call] Unexpected error writing audit log:`, err instanceof Error ? err.message : err);
  }
}
