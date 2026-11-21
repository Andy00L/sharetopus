export const USDC_DECIMALS = 6;

export type UsdcToAtomicResult = { ok: true; atomicAmount: bigint } | { ok: false; message: string };

export function usdcToAtomic(amountUsdc: number, decimals: number): UsdcToAtomicResult {
  // Number.prototype.toFixed returns exponential notation from 1e21 (ECMA-262), which BigInt cannot parse.
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0 || amountUsdc >= 1e21) {
    return { ok: false, message: `${amountUsdc} is not a positive USDC amount.` };
  }
  const fixed = amountUsdc.toFixed(decimals);
  const [wholePart, fractionPart = ""] = fixed.split(".");
  const atomicAmount = BigInt(`${wholePart}${fractionPart.padEnd(decimals, "0")}`);
  if (atomicAmount <= BigInt(0)) {
    return { ok: false, message: `${amountUsdc} USDC rounds to zero at ${decimals} decimals.` };
  }
  return { ok: true, atomicAmount };
}
