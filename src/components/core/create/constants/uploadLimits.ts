import "server-only";
import type { PlanTier } from "@/lib/types/plans";

type Megabytes = number;

export type UploadLimits = { image: Megabytes; video: Megabytes };

export const TIER_UPLOAD_LIMITS: Record<PlanTier, UploadLimits> = {
  starter: { image: 8, video: 250 },
  creator: { image: 8, video: 250 },
  pro:     { image: 8, video: 250 },
};

export const DEFAULT_UPLOAD_LIMITS: UploadLimits = { image: 8, video: 250 };
