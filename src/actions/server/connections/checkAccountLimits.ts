// actions/checkAccountLimits.ts
import { adminSupabase } from "@/actions/api/adminSupabase";
import {
  DEFAULT_ACCOUNT_LIMIT,
  PRICE_ID_ACCOUNT_LIMITS,
} from "@/lib/types/plans";
import "server-only";

export async function checkAccountLimits(
  userId: string | null,
  priceId: string | null
): Promise<{
  success: boolean;
  message: string;
  canAddMore: boolean;
  currentCount: number;
  maxAllowed: number;
}> {
  if (!userId) {
    return {
      success: false,
      message: "Missing required user ID",
      canAddMore: false,
      currentCount: 0,
      maxAllowed: 0,
    };
  }

  try {
    // Validate price ID
    if (!priceId) {
      console.error("[CheckAccountLimits] No price id provided");
      return {
        success: false,
        message: "No subscription price ID provided",
        canAddMore: false,
        currentCount: 0,
        maxAllowed: 0,
      };
    }

    // Look up the account limit for this price ID
    const maxAllowed =
      PRICE_ID_ACCOUNT_LIMITS[priceId] || DEFAULT_ACCOUNT_LIMIT;

    // Count current social accounts
    const { data: accountsData, error: accountsError } = await adminSupabase
      .from("social_accounts")
      .select("id")
      .eq("user_id", userId);

    if (accountsError) {
      console.error(
        "[checkAccountLimits] Accounts query error:",
        accountsError
      );
      return {
        success: false,
        message: `Database error: ${accountsError.message}`,
        canAddMore: false,
        currentCount: 0,
        maxAllowed,
      };
    }

    const currentCount = accountsData?.length || 0;

    // Determine if user can connect another account
    const canAddMore = currentCount < maxAllowed;

    return {
      success: true,
      message: canAddMore
        ? `User can connect more accounts (${currentCount}/${maxAllowed})`
        : `User has reached account limit (${currentCount}/${maxAllowed})`,
      canAddMore,
      currentCount,
      maxAllowed,
    };
  } catch (err) {
    console.error("[checkAccountLimits] Unexpected error:", err);
    return {
      success: false,
      message: "An unexpected error occurred",
      canAddMore: false,
      currentCount: 0,
      maxAllowed: 0,
    };
  }
}
