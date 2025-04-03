// actions/api/supabase.ts

import { supabase } from "@/actions/api/supabase";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Supabase credentials missing from environment variables");
}

// Types for social media accounts
export type SocialMediaAccount = {
  id: string;
  user_id: string;
  provider: string;
  provider_account_id: string;
  username?: string;
  display_name?: string;
  email?: string;
  avatar_url?: string;
  access_token: string;
  refresh_token?: string;
  expires_at?: string;
  token_data?: string;
  created_at: string;
  updated_at: string;
  enabled: boolean;
};

// Types for social media posts
export type SocialMediaPost = {
  id: string;
  user_id: string;
  provider: string;
  provider_post_id?: string;
  caption: string;
  media_url?: string;
  thumbnail_url?: string;
  status: "draft" | "scheduled" | "published" | "failed";
  scheduled_for?: string;
  published_at?: string;
  failure_reason?: string;
  created_at: string;
  updated_at: string;
  metadata?: string;
};

// Types for user settings
export type UserSettings = {
  id: string;
  user_id: string;
  timezone: string;
  email_notifications: boolean;
  tiktok_auto_post: boolean;
  instagram_auto_post: boolean;
  facebook_auto_post: boolean;
  threads_auto_post: boolean;
  youtube_auto_post: boolean;
  scheduling_defaults?: string;
  created_at: string;
  updated_at: string;
};

// Helper functions for working with Supabase

/**
 * Fetches all social media accounts for a user
 */
export async function fetchUserSocialAccounts(userId: string) {
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

/**
 * Fetches a specific social media account by provider
 */
export async function fetchUserSocialAccount(userId: string, provider: string) {
  const { data, error } = await supabase
    .from("social_media_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", provider)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      // No account found, which is a valid scenario
      return null;
    }
    console.error(`Error fetching ${provider} account:`, error);
    throw error;
  }

  return data as SocialMediaAccount;
}

/**
 * Fetches user's posts with optional filtering
 */
export async function fetchUserPosts(
  userId: string,
  options?: {
    provider?: string;
    status?: "draft" | "scheduled" | "published" | "failed";
    limit?: number;
    page?: number;
  }
) {
  let query = supabase
    .from("social_media_posts")
    .select("*")
    .eq("user_id", userId);

  if (options?.provider) {
    query = query.eq("provider", options.provider);
  }

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  // Add pagination
  const limit = options?.limit || 20;
  const page = options?.page || 1;
  const offset = (page - 1) * limit;

  query = query
    .order("created_at", { ascending: false })
    .limit(limit)
    .range(offset, offset + limit - 1);

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching user posts:", error);
    return [];
  }

  return data as SocialMediaPost[];
}

/**
 * Fetches user settings or creates default settings if none exist
 */
export async function getUserSettings(userId: string) {
  // First try to get existing settings
  const { data, error } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (!error && data) {
    return data as UserSettings;
  }

  if (error && error.code !== "PGRST116") {
    // Error other than "not found"
    console.error("Error fetching user settings:", error);
    throw error;
  }

  // No settings found, create default settings
  const defaultSettings = {
    user_id: userId,
    timezone: "UTC",
    email_notifications: true,
    tiktok_auto_post: false,
    instagram_auto_post: false,
    facebook_auto_post: false,
    threads_auto_post: false,
    youtube_auto_post: false,
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
