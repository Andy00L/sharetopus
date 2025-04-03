// db/accounts.ts

import { supabase } from "@/actions/api/supabase";
import { SocialMediaAccount } from "@/actions/types/SocialMediaAccount ";

/**
 * Get all social media accounts for a user
 */
export async function getAllSocialAccounts(
  userId: string
): Promise<SocialMediaAccount[]> {
  const { data, error } = await supabase
    .from("social_media_accounts")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    console.error("Error fetching user social accounts:", error);
    return [];
  }

  return data as SocialMediaAccount[];
}
