import "server-only";

/**
 * Returns the canonical period string for usage_quotas lookups and writes.
 *
 * The usage_quotas.period column is a date storing the first day of the
 * month as "YYYY-MM-DD". All readers and writers MUST use this helper.
 * Any divergence (e.g. "YYYY-MM") creates silent zero-result queries.
 */
export function currentQuotaPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
