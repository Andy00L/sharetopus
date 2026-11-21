import "server-only";
import {
  DEFAULT_UPLOAD_LIMITS,
  TIER_UPLOAD_LIMITS,
  type UploadLimits,
} from "@/lib/storage/uploadLimits";
import type { PlanTier } from "@/lib/types/plans";

export function getUploadLimitsForPrincipal(
  tier: PlanTier | null,
): UploadLimits {
  if (tier === null) return DEFAULT_UPLOAD_LIMITS;
  return TIER_UPLOAD_LIMITS[tier];
}
