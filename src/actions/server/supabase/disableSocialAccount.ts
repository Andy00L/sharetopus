// db/accounts.ts

import { supabase } from "@/actions/api/supabase";
import { Provider } from "@/actions/types/provider";

/**
 * Disable a social media account (when tokens become invalid, etc.)
 */
export async function disableSocialAccount(
  userId: string,
  provider: Provider,
  reason?: string
): Promise<boolean> {
  const { error } = await supabase
    .from("social_media_accounts")
    .update({
      enabled: false,
      updated_at: new Date().toISOString(),
      token_data: reason
        ? JSON.stringify({ disableReason: reason })
        : undefined,
    })
    .eq("user_id", userId)
    .eq("provider", provider);

  if (error) {
    console.error(`Error disabling ${provider} account:`, error);
    return false;
  }

  return true;
}
