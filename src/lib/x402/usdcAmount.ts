import "server-only";

export function usdcToAtomic(amountUsdc: number, decimals: number): string {
  // Number.prototype.toFixed returns exponential notation from 1e21 (ECMA-262), which BigInt cannot parse.
  if (!Number.isFinite(amountUsdc) || amountUsdc < 0 || amountUsdc >= 1e21) {
    console.error(`[usdcToAtomic] Rejecting out-of-range amount: ${amountUsdc}`);
    return "0";
  }
  const fixed = amountUsdc.toFixed(decimals);
  const [wholePart, fractionPart = ""] = fixed.split(".");
  return BigInt(`${wholePart}${fractionPart.padEnd(decimals, "0")}`).toString();
}
