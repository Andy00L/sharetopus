import "server-only";
import type { PlanTier } from "@/lib/types/plans";

export type UploadLimits = { image: number; video: number };

// Per-tier upload size caps in MB.
// Currently uniform across tiers; the structure exists so per-tier
// differentiation can be added later without touching call sites.
export const TIER_UPLOAD_LIMITS: Record<PlanTier, UploadLimits> = {
  starter: { image: 8, video: 250 },
  creator: { image: 8, video: 250 },
  pro:     { image: 8, video: 250 },
};

export const DEFAULT_UPLOAD_LIMITS: UploadLimits = { image: 8, video: 250 };
