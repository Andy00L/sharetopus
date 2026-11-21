import "server-only";

import { db, runQuery } from "@/db/client";
import { x402_access_log, type X402_ACCESS_RESULT_STATUSES } from "@/db/schema";
import type { WalletPrincipal } from "@/lib/x402/auth/types";

const MAX_USER_AGENT_LENGTH = 512;

export interface X402AuditEntry {
  principal: WalletPrincipal | null;

  action: string | null;

  endpoint: string;

  chargeId: string | null;

  resultStatus: (typeof X402_ACCESS_RESULT_STATUSES)[number];

  latencyMs?: number;

  ipHash?: string | null;

  userAgent?: string | null;
}

export async function logX402Call(entry: X402AuditEntry): Promise<void> {
  const truncatedUserAgent =
    entry.userAgent && entry.userAgent.length > MAX_USER_AGENT_LENGTH
      ? entry.userAgent.slice(0, MAX_USER_AGENT_LENGTH)
      : entry.userAgent ?? null;

  if (entry.resultStatus === "402_required") {
    console.log(
      `[logX402Call] 402 challenge on ${entry.endpoint} (${entry.action ?? "no action"}) in ${entry.latencyMs ?? "unknown"} ms, user agent: ${truncatedUserAgent ?? "none"}`,
    );
    return;
  }

  const { error } = await runQuery(
    db.insert(x402_access_log).values({
      principal_id: entry.principal?.principalId ?? null,
      wallet_id: entry.principal?.principalId ?? null,
      endpoint: entry.endpoint,
      action: entry.action,
      charge_id: entry.chargeId,
      result_status: entry.resultStatus,
      latency_ms: entry.latencyMs ?? null,
      ip_hash: entry.ipHash ?? null,
      user_agent: truncatedUserAgent,
    }),
  );

  if (error) {
    console.error(`[logX402Call] Failed to insert audit row for ${entry.endpoint}: ${error.message}`);
  }
}
