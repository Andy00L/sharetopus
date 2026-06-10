import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import type { PricingRecurrence } from "@/lib/types/database.types";

/**
 * Action ids charged by the public x402 endpoints, and nothing else.
 *
 * pricing_actions also holds audit-only rows (FK targets for
 * x402_access_log.action, e.g. the share_link.* ids) that are never
 * purchasable; selecting by this allow-list keeps them off the public page.
 *
 * sourceRef: resolveAction call sites in src/app/api/x402/<route>/route.ts,
 *            src/lib/x402/middleware/resolvePostAction.ts,
 *            src/lib/x402/register/handleRegisterChallenge.ts,
 *            src/lib/x402/connect/handleConnectChallenge.ts
 */
const PUBLIC_X402_ACTIONS = [
  "cancel",
  "connect_account",
  "delete",
  "list_connections",
  "list_history",
  "list_posts",
  "post.image",
  "post.text",
  "post.video",
  "register",
  "reschedule",
  "upload_url",
] as const;

export interface PricingRow {
  action: string;
  displayName: string;
  usdcPrice: number;
  description: string | null;
  recurrence: PricingRecurrence;
}

export type PricingResult =
  | { ok: true; rows: PricingRow[] }
  | { ok: false; reason: string };

/**
 * Reads the currently effective public pricing rows for the docs page.
 *
 * Mirrors the temporal-window rule of the runtime lookup
 * (src/lib/x402/pricing/readActionPrice.ts): a row is effective when
 * effective_from <= now and effective_until is null or in the future.
 * Read-only, never throws; the page renders a fallback line on ok: false.
 */
export async function fetchX402Pricing(): Promise<PricingResult> {
  const nowIso = new Date().toISOString();

  const { data, error } = await adminSupabase
    .from("pricing_actions")
    .select("action, display_name, usdc_price, description, recurrence")
    .in("action", [...PUBLIC_X402_ACTIONS])
    .lte("effective_from", nowIso)
    .or(`effective_until.is.null,effective_until.gt.${nowIso}`)
    .order("action");

  if (error) {
    console.error(
      `[fetchX402Pricing] pricing_actions read failed: ${error.message}`
    );
    return { ok: false, reason: "pricing_read_failed" };
  }

  const rows: PricingRow[] = (data ?? []).map((row) => ({
    action: row.action,
    displayName: row.display_name,
    usdcPrice: row.usdc_price,
    description: row.description,
    recurrence: row.recurrence,
  }));

  return { ok: true, rows };
}
