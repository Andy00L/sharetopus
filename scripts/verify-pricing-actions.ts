/**
 * Pre-deploy check: verify the pricing_actions table has the expected rows
 * with the expected USDC prices. Catches drift between code expectations
 * and DB state.
 *
 * Run with: npx tsx scripts/verify-pricing-actions.ts
 *
 * Reads:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE
 *
 * Exit codes:
 *   0 = all 10 rows present and prices match
 *   1 = drift or missing rows
 *   2 = config error or can't connect
 */

import type { Database } from "@/lib/types/database.types";
import { createClient } from "@supabase/supabase-js";

// The `server-only` guard in adminSupabase.ts blocks non-Next.js usage.
// Scripts create a direct Supabase client instead.

// ---------------------------------------------------------------------------
// Expected pricing actions
// ---------------------------------------------------------------------------

interface ExpectedAction {
  action: string;
  expectedUsdcPrice: number;
}

const EXPECTED_ACTIONS: ExpectedAction[] = [
  { action: "register", expectedUsdcPrice: 1.0 },
  { action: "connect_account", expectedUsdcPrice: 0.5 },
  { action: "post.text", expectedUsdcPrice: 0.5 },
  { action: "post.image", expectedUsdcPrice: 0.75 },
  { action: "post.video", expectedUsdcPrice: 1.0 },
  { action: "reschedule", expectedUsdcPrice: 0.1 },
  { action: "bulk_schedule", expectedUsdcPrice: 0.5 },
  { action: "cancel", expectedUsdcPrice: 0.0 },
  { action: "analytics_query", expectedUsdcPrice: 0.05 },
  { action: "storage_overage", expectedUsdcPrice: 0.05 },
];

/** Tolerance for float comparison. */
const PRICE_TOLERANCE = 0.0001;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE;

  if (!supabaseUrl || !serviceRole) {
    console.error(
      "[verifyPricingActions] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE are required.",
    );
    process.exit(2);
  }

  const supabase = createClient<Database>(supabaseUrl, serviceRole);

  // Fetch all pricing_actions rows
  const { data, error } = await supabase
    .from("pricing_actions")
    .select("action, usdc_price, display_name");

  if (error) {
    console.error(`[verifyPricingActions] DB query failed: ${error.message}`);
    process.exit(2);
  }

  if (!data) {
    console.error(
      "[verifyPricingActions] No data returned from pricing_actions.",
    );
    process.exit(2);
  }

  // Build a map of action -> usdc_price from DB
  const dbMap = new Map<string, number>();
  for (const row of data) {
    dbMap.set(row.action, Number(row.usdc_price));
  }

  // Compare
  let hasDrift = false;
  const missingRows: string[] = [];

  console.log("[verifyPricingActions] Checking pricing_actions rows:");
  for (const expected of EXPECTED_ACTIONS) {
    const dbPrice = dbMap.get(expected.action);

    if (dbPrice === undefined) {
      console.log(
        `[verifyPricingActions]   x ${expected.action}: MISSING (expected ${expected.expectedUsdcPrice.toFixed(2)} USDC)`,
      );
      missingRows.push(expected.action);
      hasDrift = true;
      continue;
    }

    const priceDiff = Math.abs(dbPrice - expected.expectedUsdcPrice);
    if (priceDiff > PRICE_TOLERANCE) {
      console.log(
        `[verifyPricingActions]   x ${expected.action}: ${dbPrice.toFixed(6)} USDC (expected ${expected.expectedUsdcPrice.toFixed(2)})   <- DRIFT`,
      );
      hasDrift = true;
    } else {
      console.log(
        `[verifyPricingActions]   + ${expected.action}: ${dbPrice.toFixed(6)} USDC (expected ${expected.expectedUsdcPrice.toFixed(2)})`,
      );
    }
  }

  // Check for extra rows not in expected list
  const expectedKeys = new Set(EXPECTED_ACTIONS.map((e) => e.action));
  const extraRows = data.filter((row) => !expectedKeys.has(row.action));
  if (extraRows.length > 0) {
    console.log(
      "[verifyPricingActions] Extra rows in pricing_actions (not in expected list):",
    );
    for (const row of extraRows) {
      console.log(
        `[verifyPricingActions]     ? ${row.action}: ${Number(row.usdc_price).toFixed(6)} USDC`,
      );
    }
  }

  if (missingRows.length > 0) {
    console.log(
      `[verifyPricingActions] Missing rows: [${missingRows.join(", ")}]`,
    );
  }

  if (hasDrift || missingRows.length > 0) {
    console.log("[verifyPricingActions] FAIL: drift or missing rows detected.");
    process.exit(1);
  } else {
    console.log(
      `[verifyPricingActions] PASS: all ${EXPECTED_ACTIONS.length} rows present and prices match.`,
    );
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(
    "[verifyPricingActions] Fatal error:",
    err instanceof Error ? err.message : err,
  );
  process.exit(2);
});
