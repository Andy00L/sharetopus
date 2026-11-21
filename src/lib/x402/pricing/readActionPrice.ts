import "server-only";

import { and, eq, gt, isNull, lte, or, type SQL } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { pricing_actions } from "@/db/schema";

export const PURCHASABLE_X402_ACTIONS = [
  "cancel",
  "connect_account",
  "delete",
  "list_connections",
  "list_history",
  "list_posts",
  "post.image",
  "post.text",
  "post.video",
  "reschedule",
  "upload_url",
] as const;

export type PurchasableX402Action = (typeof PURCHASABLE_X402_ACTIONS)[number];

export function isPriceEffectiveAt(nowIso: string): SQL | undefined {
  return and(
    lte(pricing_actions.effective_from, nowIso),
    or(isNull(pricing_actions.effective_until), gt(pricing_actions.effective_until, nowIso)),
  );
}

const PRICE_CACHE_TTL_MS = 10 * 60_000;

const MAX_ACTION_PRICE_USDC = 100;

export type ReadActionPriceResult =
  | { ok: true; usdcPrice: number }
  | { ok: false; message: string };

const priceCacheByAction = new Map<
  PurchasableX402Action,
  { usdcPrice: number; expiresAtMs: number }
>();

export async function readActionPrice(
  action: PurchasableX402Action,
): Promise<ReadActionPriceResult> {
  const cachedPrice = priceCacheByAction.get(action);
  if (cachedPrice && cachedPrice.expiresAtMs > Date.now()) {
    return { ok: true, usdcPrice: cachedPrice.usdcPrice };
  }
  return readFreshActionPrice(action);
}

export async function readFreshActionPrice(
  action: PurchasableX402Action,
): Promise<ReadActionPriceResult> {
  const nowIso = new Date().toISOString();
  const { data: pricingRows, error: pricingError } = await runQuery(
    db
      .select({
        usdc_price: pricing_actions.usdc_price,
        effective_until: pricing_actions.effective_until,
      })
      .from(pricing_actions)
      .where(and(eq(pricing_actions.action, action), isPriceEffectiveAt(nowIso)))
      .limit(1),
  );

  if (pricingError) {
    console.error(
      `[readActionPrice] pricing_actions read failed for "${action}": ${pricingError.message}`,
    );
    return { ok: false, message: "Failed to read pricing." };
  }

  const pricingRow = pricingRows[0];
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

  priceCacheByAction.set(action, {
    usdcPrice,
    expiresAtMs: readCacheExpiryMs(pricingRow.effective_until),
  });
  return { ok: true, usdcPrice };
}

function readCacheExpiryMs(effectiveUntil: string | null): number {
  const ttlExpiryMs = Date.now() + PRICE_CACHE_TTL_MS;
  if (effectiveUntil === null) return ttlExpiryMs;
  return Math.min(ttlExpiryMs, new Date(effectiveUntil).getTime());
}
