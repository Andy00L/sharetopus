import { adminSupabase } from "@/actions/api/adminSupabase";
import { SocialAccount } from "@/lib/types/dbTypes";
import "server-only";

/**
 * Fetches social accounts for a specific user with optional availability filtering
 * @param userId - The ID of the user whose social accounts to fetch
 * @param filterByAvailability - When true, only returns accounts marked as available (default: true)
 * @returns Promise resolving to an array of social accounts
 */
export async function fetchSocialAccounts(
  userId: string | null,
  filterByAvailability: boolean = true
): Promise<SocialAccount[]> {
  // Get user ID using server-side auth

  if (!userId) {
    console.error(
      "[FetchScocialAccounts] User not authenticated in fetchSocialAccounts."
    );
    // Return empty array or throw error based on how you want to handle this
    return [];
  }

  try {
    // Fetch data using the admin client (bypasses RLS if needed)
    // Start building the query
    let query = adminSupabase
      .from("social_accounts")
      .select("*")
      .eq("user_id", userId);

    // Only apply the availability filter if requested
    if (filterByAvailability) {
      query = query.eq("is_availble", true);
    }

    // Execute the query
    const { data, error } = await query;

    if (error) {
      console.error(
        "[FetchScocialAccounts]: Supabase error fetching TikTok accounts:",
        error
      );
      return [];
    }

    // Ensure data is returned as an array
    return (data as SocialAccount[]) || [];
  } catch (err) {
    console.error(
      "[FetchScocialAccounts]: Failed to fetch TikTok accounts:",
      err
    );
    return []; // Return empty array on unexpected errors
  }
}
