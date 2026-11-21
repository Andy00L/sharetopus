import "server-only";
import {
  TIER_UPLOAD_LIMITS,
  DEFAULT_UPLOAD_LIMITS,
} from "@/components/core/create/constants/uploadLimits";
import type { PlanTier } from "@/lib/types/plans";

export type UploadLimits = { image: number; video: number };

export function getUploadLimitsForPrincipal(
  tier: PlanTier | null,
): UploadLimits {
  if (tier === null) return DEFAULT_UPLOAD_LIMITS;
  return TIER_UPLOAD_LIMITS[tier];
}
