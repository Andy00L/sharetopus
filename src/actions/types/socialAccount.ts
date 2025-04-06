// src/types/socialAccount.ts (or a similar path)

import { Provider } from "./provider";

// Define types for the extra JSON field
export interface SocialProfile {
  id: string;
  username: string;
  avatar_url?: string;
  is_verified?: boolean;
  display_name?: string;
  follower_count?: number;
  following_count?: number;
  bio_description?: string;
}

export interface TokenInfo {
  scope?: string;
  token_type?: string;
  refresh_expires_in?: number;
}

export interface ConnectionStatus {
  connected_at?: string;
  profile_fetch_successful?: boolean;
}

export interface ExtraData {
  profile?: SocialProfile;
  token_info?: TokenInfo;
  connection_status?: ConnectionStatus;
}

// Extend the social_accounts table type from the database schema
export interface SocialAccount {
  id: string;
  user_id: string;
  platform: Provider | string; // Use string if Provider type is complex to share
  account_identifier: string;
  access_token: string;
  refresh_token?: string | null;
  token_expires_at?: string | null;
  extra?: ExtraData;
  created_at: string;
  updated_at: string;
}
