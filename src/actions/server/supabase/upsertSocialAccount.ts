import { supabase } from "@/actions/api/supabase";
import { Provider } from "@/actions/types/provider";
import { SocialMediaAccount } from "@/actions/types/SocialMediaAccount ";
import { TokenExchangeResponse } from "@/actions/types/TokenExchangeResponse";

/**
 * Create or update a social media account in the database
 */
export async function upsertSocialAccount(
  userId: string,
  provider: Provider,
  tokenData: TokenExchangeResponse,
  profileData: {
    username?: string;
    display_name?: string;
    email?: string;
    avatar_url?: string;
    provider_account_id: string;
  }
): Promise<SocialMediaAccount | null> {
  const now = new Date().toISOString();
  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : undefined;

  const accountData = {
    user_id: userId,
    provider,
    provider_account_id: profileData.provider_account_id,
    username: profileData.username,
    display_name: profileData.display_name,
    email: profileData.email,
    avatar_url: profileData.avatar_url,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: expiresAt,
    token_data: JSON.stringify(tokenData),
    updated_at: now,
    enabled: true,
  };

  const { data, error } = await supabase
    .from("social_media_accounts")
    .upsert(accountData, {
      onConflict: "user_id, provider",
    });

  if (error) {
    console.error("Error upserting social account:", error);
    return null;
  }

  return data?.[0] as unknown as SocialMediaAccount;
}
