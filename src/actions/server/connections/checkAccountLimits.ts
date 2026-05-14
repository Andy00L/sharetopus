import { adminSupabase } from "@/actions/api/adminSupabase";
import {
  TIER_ACCOUNT_LIMITS,
  type PlanTier,
} from "@/lib/types/plans";
import "server-only";

export async function checkAccountLimits(
  userId: string | null,
  tier: PlanTier | null,
): Promise<{
  success: boolean;
  message: string;
  canAddMore: boolean;
  currentCount: number;
  maxAllowed: number;
  isUnlimited: boolean;
}> {
  if (!userId) {
    return {
      success: false,
      message: "Missing required user ID",
      canAddMore: false,
      currentCount: 0,
      maxAllowed: 0,
      isUnlimited: false,
    };
  }

  if (tier === null) {
    return {
      success: false,
      message: "No active subscription. Cannot add accounts.",
      canAddMore: false,
      currentCount: 0,
      maxAllowed: 0,
      isUnlimited: false,
    };
  }

  // tier is passed in directly from the reader. No conversion happens here.
  const maxAllowed = TIER_ACCOUNT_LIMITS[tier];
  const isUnlimited = !Number.isFinite(maxAllowed);

  try {
    const { data, error } = await adminSupabase
      .from("social_accounts")
      .select("id")
      .eq("principal_id", userId)
      .is("deleted_at", null);

    if (error) {
      console.error("[checkAccountLimits] DB error:", error.message);
      return {
        success: false,
        message: `Database error: ${error.message}`,
        canAddMore: false,
        currentCount: 0,
        maxAllowed,
        isUnlimited,
      };
    }

    const currentCount = data?.length ?? 0;
    const canAddMore = isUnlimited || currentCount < maxAllowed;

    return {
      success: true,
      message: canAddMore
        ? `User can connect more (${currentCount}/${isUnlimited ? "unlimited" : maxAllowed})`
        : `Account limit reached (${currentCount}/${maxAllowed})`,
      canAddMore,
      currentCount,
      maxAllowed,
      isUnlimited,
    };
  } catch (err) {
    console.error("[checkAccountLimits] Unexpected:", err);
    return {
      success: false,
      message: "An unexpected error occurred",
      canAddMore: false,
      currentCount: 0,
      maxAllowed: 0,
      isUnlimited: false,
    };
  }
}
