import "server-only";

/**
 * Integer-safe conversion from human USDC amounts to atomic base units.
 *
 * pricing_actions.usdc_price arrives as a JS number (PostgREST serializes
 * numeric to a JSON number). Settlement math must never multiply floats, so
 * the conversion goes through a fixed-decimal string: format to exactly
 * `decimals` fraction digits, then shift the decimal point textually and
 * validate via BigInt.
 *
 * Called by: facilitator.ts, http/paymentHttp.ts, solana/refundSolana.ts
 * Tables touched: none
 */

export function usdcToAtomic(amountUsdc: number, decimals: number): string {
  // toFixed switches to exponential notation at 1e21, which would make the
  // BigInt below throw; any such "price" is corrupted upstream anyway.
  if (!Number.isFinite(amountUsdc) || amountUsdc < 0 || amountUsdc >= 1e21) {
    // Returning "0" makes the facilitator reject instead of charging garbage.
    console.error(`[usdcToAtomic] Rejecting out-of-range amount: ${amountUsdc}`);
    return "0";
  }
  const fixed = amountUsdc.toFixed(decimals);
  const [wholePart, fractionPart = ""] = fixed.split(".");
  return BigInt(`${wholePart}${fractionPart.padEnd(decimals, "0")}`).toString();
}
