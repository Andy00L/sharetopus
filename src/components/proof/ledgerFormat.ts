const MIDDLE_ELLIPSIS = "\u2026";
const USDC_DECIMALS = 6;
const PRICE_MIN_FRACTION_DIGITS = 2;

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

const UTC_TIMESTAMP_FORMAT = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export function formatUtcTimestamp(isoTimestamp: string): string {
  return `${UTC_TIMESTAMP_FORMAT.format(new Date(isoTimestamp))} UTC`;
}

const USDC_AMOUNT_FORMAT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: PRICE_MIN_FRACTION_DIGITS,
  maximumFractionDigits: USDC_DECIMALS,
});

export function formatUsdc(amountUsdc: number): string {
  return `${USDC_AMOUNT_FORMAT.format(amountUsdc)} USDC`;
}
