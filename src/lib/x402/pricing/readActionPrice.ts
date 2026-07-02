import "server-only";

/**
 * Reads the currently effective USDC price for a pricing action.
 *
 * pricing_actions is keyed by action (primary key) and versioned in place
 * via effective_from / effective_until; a row outside its window means the
 * action is not currently purchasable, even though the row exists for FK
 * purposes. Every x402 pricing lookup goes through this one function so the
 * temporal-window rules cannot drift between flows.
 *
 * Called by: x402PaidEndpoint, handleConnectChallenge, handleConnectVerify
 * Tables touched: pricing_actions (read)
 */

import { adminSupabase } from "@/actions/api/adminSupabase";

export type ReadActionPriceResult =
  | { ok: true; usdcPrice: number }
  | { ok: false; message: string };

export async function readActionPrice(
  action: string
): Promise<ReadActionPriceResult> {
  const nowIso = new Date().toISOString();

  const { data: pricingRow, error: pricingError } = await adminSupabase
    .from("pricing_actions")
    .select("usdc_price")
    .eq("action", action)
    .lte("effective_from", nowIso)
    .or(`effective_until.is.null,effective_until.gt.${nowIso}`)
    .maybeSingle();

  if (pricingError) {
    console.error(
      `[readActionPrice] pricing_actions read failed for "${action}": ${pricingError.message}`
    );
    return { ok: false, message: "Failed to read pricing." };
  }

  if (!pricingRow) {
    return {
      ok: false,
      message: `No active pricing for action "${action}".`,
    };
  }

  return { ok: true, usdcPrice: pricingRow.usdc_price };
}
