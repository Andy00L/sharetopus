/**
 * Display formatting for the proof ledger. Shared by the ledger
 * table and the latest-receipt card so both print identifiers, amounts,
 * and times the same way (docs/UI_DESIGN_SYSTEM.md, "The Solana proof
 * ledger"). Pure functions, safe on the server and the client.
 */

/** Horizontal ellipsis, U+2026. One glyph, so the head and tail stay aligned. */
const MIDDLE_ELLIPSIS = "…";

/** Keeps the first and last characters of a long identifier. */
export function truncateMiddle(
  value: string,
  headLength: number,
  tailLength: number,
): string {
  if (value.length <= headLength + tailLength + MIDDLE_ELLIPSIS.length) {
    return value;
  }
  return `${value.slice(0, headLength)}${MIDDLE_ELLIPSIS}${value.slice(-tailLength)}`;
}

// A fixed zone keeps server and client output identical (no hydration drift)
// and makes every row comparable with an explorer's UTC block time.
const UTC_TIMESTAMP_FORMAT = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export function formatUtcTimestamp(isoTimestamp: string): string {
  return `${UTC_TIMESTAMP_FORMAT.format(new Date(isoTimestamp))} UTC`;
}

// USDC has 6 decimals (src/lib/x402/networks.ts usdcDecimals); two are the
// floor so 0.5 prints as a price, not a fraction.
const USDC_AMOUNT_FORMAT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

export function formatUsdc(amountUsdc: number): string {
  return `${USDC_AMOUNT_FORMAT.format(amountUsdc)} USDC`;
}
