import "server-only";

import { and, asc, inArray } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { pricing_actions } from "@/db/schema";
import type { PricingRecurrence } from "@/db/schema";
import {
  isPriceEffectiveAt,
  PURCHASABLE_X402_ACTIONS,
} from "@/lib/x402/pricing/readActionPrice";

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

export async function fetchX402Pricing(): Promise<PricingResult> {
  const nowIso = new Date().toISOString();

  const { data: pricingRows, error } = await runQuery(
    db
      .select({
        action: pricing_actions.action,
        display_name: pricing_actions.display_name,
        usdc_price: pricing_actions.usdc_price,
        description: pricing_actions.description,
        recurrence: pricing_actions.recurrence,
      })
      .from(pricing_actions)
      .where(
        and(
          inArray(pricing_actions.action, [...PURCHASABLE_X402_ACTIONS]),
          isPriceEffectiveAt(nowIso)
        )
      )
      .orderBy(asc(pricing_actions.action))
  );

  if (error) {
    console.error(
      `[fetchX402Pricing] pricing_actions read failed: ${error.message}`
    );
    return { ok: false, reason: "pricing_read_failed" };
  }

  const rows: PricingRow[] = pricingRows.map((row) => ({
    action: row.action,
    displayName: row.display_name,
    usdcPrice: row.usdc_price,
    description: row.description,
    recurrence: row.recurrence,
  }));

  return { ok: true, rows };
}
