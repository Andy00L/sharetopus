import { supabase } from "@/actions/api/supabase";
import { Provider } from "@/actions/types/provider";
import { SocialMediaAccount } from "@/actions/types/SocialMediaAccount ";

/**
 * Get a user's social media account by provider
 */
export async function getSocialAccount(
  userId: string,
  provider: Provider
): Promise<SocialMediaAccount | null> {
  const { data, error } = await supabase
    .from("social_media_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", provider)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      // No rows returned
      return null;
    }
    console.error(`Error fetching ${provider} account:`, error);
    throw error;
  }

  return data as SocialMediaAccount;
}
