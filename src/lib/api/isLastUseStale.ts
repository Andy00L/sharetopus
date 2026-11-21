export const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

export function isLastUseStale(lastUsedAt: string | null, nowMs: number): boolean {
  if (lastUsedAt === null) return true;
  const lastUsedMs = Date.parse(lastUsedAt);
  return Number.isNaN(lastUsedMs) || nowMs - lastUsedMs >= LAST_USED_WRITE_INTERVAL_MS;
}
