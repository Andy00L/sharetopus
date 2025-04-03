// db/settings.ts
import { supabase } from "@/actions/api/supabase";
import { Provider } from "@/actions/types/provider";

export type UserSettings = {
  id: string;
  user_id: string;
  timezone: string;
  email_notifications: boolean;
  scheduling_defaults?: Record<string, unknown>;
  auto_post_settings: Record<Provider, boolean>;
  created_at: string;
  updated_at: string;
};

/**
 * Get user settings (creates default settings if none exist)
 */
export async function getUserSettings(userId: string): Promise<UserSettings> {
  // First try to get existing settings
  const { data, error } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (!error && data) {
    // Parse auto_post_settings if stored as JSON string
    const settings = data as UserSettings;
    if (typeof settings.auto_post_settings === "string") {
      settings.auto_post_settings = JSON.parse(settings.auto_post_settings);
    }
    if (typeof settings.scheduling_defaults === "string") {
      settings.scheduling_defaults = JSON.parse(settings.scheduling_defaults);
    }
    return settings;
  }

  if (error && error.code !== "PGRST116") {
    // Error other than "not found"
    console.error("Error fetching user settings:", error);
    throw error;
  }

  // No settings found, create default settings
  const now = new Date().toISOString();
  const defaultSettings = {
    user_id: userId,
    timezone: "UTC",
    email_notifications: true,
    auto_post_settings: {
      tiktok: false,
      instagram: false,
      facebook: false,
      threads: false,
      youtube: false,
    },
    created_at: now,
    updated_at: now,
  };

  const { data: newSettings, error: createError } = await supabase
    .from("user_settings")
    .insert(defaultSettings)
    .select()
    .single();

  if (createError) {
    console.error("Error creating user settings:", createError);
    throw createError;
  }

  return newSettings as UserSettings;
}
