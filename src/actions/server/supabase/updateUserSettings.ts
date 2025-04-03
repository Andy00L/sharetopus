// db/settings.ts

import { supabase } from "@/actions/api/supabase";
import { Provider } from "@/actions/types/provider";
import { getUserSettings } from "./getUserSettings";

/**
 * Update user settings
 */
export async function updateUserSettings(
  userId: string,
  updates: Partial<{
    timezone: string;
    email_notifications: boolean;
    scheduling_defaults: Record<string, unknown>;
    auto_post_settings: Partial<Record<Provider, boolean>>;
  }>
): Promise<boolean> {
  // Get current settings first to do partial update of nested objects
  const currentSettings = await getUserSettings(userId);

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (updates.timezone !== undefined) {
    updateData.timezone = updates.timezone;
  }

  if (updates.email_notifications !== undefined) {
    updateData.email_notifications = updates.email_notifications;
  }

  if (updates.scheduling_defaults) {
    updateData.scheduling_defaults = JSON.stringify({
      ...currentSettings.scheduling_defaults,
      ...updates.scheduling_defaults,
    });
  }

  if (updates.auto_post_settings) {
    updateData.auto_post_settings = JSON.stringify({
      ...currentSettings.auto_post_settings,
      ...updates.auto_post_settings,
    });
  }

  const { error } = await supabase
    .from("user_settings")
    .update(updateData)
    .eq("user_id", userId);

  if (error) {
    console.error("Error updating user settings:", error);
    return false;
  }

  return true;
}
