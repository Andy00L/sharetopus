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
 * The price is validated here, once: a missing, non-numeric, zero, negative
 * or implausibly large price fails closed instead of reaching usdcToAtomic,
 * where it would turn into a zero-amount requirement.
 *
 * Results are cached per instance for PRICE_CACHE_TTL_MS, so every paid call
 * and every unpaid 402 probe does not cost a database read. A price change
 * or a window boundary therefore takes effect up to that long late.
 *
 * Called by: x402PaidEndpoint, connect/handleConnectChallenge,
 *            connect/handleConnectVerify, solanaActions/postNowBlink
 * Tables touched: pricing_actions (read)
 */

import { adminSupabase } from "@/actions/api/adminSupabase";

/** Per-instance price cache lifetime, in milliseconds. */
const PRICE_CACHE_TTL_MS = 60_000;

/**
 * Upper bound on a sane per-call price, in USDC. The most expensive action
 * today is post.video; anything above this is a data-entry error.
 */
const MAX_ACTION_PRICE_USDC = 100;

export type ReadActionPriceResult =
  | { ok: true; usdcPrice: number }
  | { ok: false; message: string };

const priceCacheByAction = new Map<string, { usdcPrice: number; expiresAtMs: number }>();

export async function readActionPrice(
  action: string,
): Promise<ReadActionPriceResult> {
  const cachedPrice = priceCacheByAction.get(action);
  if (cachedPrice && cachedPrice.expiresAtMs > Date.now()) {
    return { ok: true, usdcPrice: cachedPrice.usdcPrice };
  }

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
      `[readActionPrice] pricing_actions read failed for "${action}": ${pricingError.message}`,
    );
    return { ok: false, message: "Failed to read pricing." };
  }

  if (!pricingRow) {
    return { ok: false, message: `No active pricing for action "${action}".` };
  }

  const usdcPrice = Number(pricingRow.usdc_price);
  if (!Number.isFinite(usdcPrice) || usdcPrice <= 0 || usdcPrice > MAX_ACTION_PRICE_USDC) {
    console.error(
      `[readActionPrice] Rejecting invalid price for "${action}": ${String(pricingRow.usdc_price)}`,
    );
    return { ok: false, message: `Pricing for action "${action}" is misconfigured.` };
  }

  priceCacheByAction.set(action, { usdcPrice, expiresAtMs: Date.now() + PRICE_CACHE_TTL_MS });
  return { ok: true, usdcPrice };
}
