"server only";
import { adminSupabase } from "@/actions/api/supabase-client";
import { SocialAccount } from "@/lib/types/dbTypes";

export async function fetchSocialAccounts(
  userId: string | null
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
    const { data, error } = await adminSupabase
      .from("social_accounts")
      .select("*")
      .eq("user_id", userId);

    if (error) {
      console.error(
        "[FetchScocialAccounts]: Supabase error fetching TikTok accounts:",
        error
      );
      // Depending on your error handling strategy, you might throw the error
      // or return an empty array. Returning empty allows the page to render.
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
