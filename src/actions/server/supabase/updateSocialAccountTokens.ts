import { supabase } from "@/actions/api/supabase";
import { Provider } from "@/actions/types/provider";

/**
 * Update access token for a social media account
 */
export async function updateSocialAccountTokens(
  userId: string,
  provider: Provider,
  tokenData: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  }
): Promise<boolean> {
  const updateData: Record<string, unknown> = {
    access_token: tokenData.access_token,
    updated_at: new Date().toISOString(),
  };

  if (tokenData.refresh_token) {
    updateData.refresh_token = tokenData.refresh_token;
  }

  if (tokenData.expires_in) {
    updateData.expires_at = new Date(
      Date.now() + tokenData.expires_in * 1000
    ).toISOString();
  }

  const { error } = await supabase
    .from("social_media_accounts")
    .update(updateData)
    .eq("user_id", userId)
    .eq("provider", provider);

  if (error) {
    console.error(`Error updating ${provider} token:`, error);
    return false;
  }

  return true;
}
