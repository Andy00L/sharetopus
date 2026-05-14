import { adminSupabase } from "@/actions/api/adminSupabase";
import {
  priceIdToTier,
  TIER_ACCOUNT_LIMITS,
  type PlanTier,
} from "@/lib/types/plans";
import "server-only";

export async function checkAccountLimits(
  userId: string | null,
  plan: PlanTier | string | null,
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

  // priceIdToTier resolves:
  //   - null -> "free"
  //   - a Stripe priceId -> proper tier from PRICE_ID_TO_TIER map
  //   - a tier name (defensive, for legacy data) -> same tier
  //   - anything unknown -> "free" (fail-closed, logs)
  const tier: PlanTier = priceIdToTier(plan ?? null);
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
