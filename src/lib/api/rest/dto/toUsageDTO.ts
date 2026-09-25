import type { UsageDTO } from "@/lib/api/rest/openapi/responseSchemas";
import type { PlanTier } from "@/lib/types/plans";
import { TIER_STORAGE_LIMITS, DEFAULT_STORAGE_LIMIT } from "@/lib/types/plans";

/** Formats bytes as a human-readable string (e.g. "2.3 GB"). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Builds a UsageDTO from resolved subscription, quota rows, and storage RPC
 * result. Its shape is UsageDTOSchema (responseSchemas.ts), the same schema
 * the OpenAPI spec renders; Stripe internal fields (stripe_customer_id,
 * stripe_price_id, stripe_subscription_id) stay out.
 */
export function buildUsageDTO(input: {
  tier: PlanTier | null;
  status: string;
  currentPeriodEnd: string | null;
  period: string;
  actionCounts: Record<string, number>;
  storageUsedBytes: number;
}): UsageDTO {
  const capBytes =
    input.tier !== null
      ? TIER_STORAGE_LIMITS[input.tier]
      : DEFAULT_STORAGE_LIMIT;

  return {
    plan: input.tier,
    status: input.status,
    current_period_end: input.currentPeriodEnd,
    period: input.period,
    actions: input.actionCounts,
    storage: {
      used_bytes: input.storageUsedBytes,
      cap_bytes: capBytes,
      used_human: formatBytes(input.storageUsedBytes),
      cap_human: formatBytes(capBytes),
    },
  };
}
