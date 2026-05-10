import type { Tables, Json } from "./database.types";

// Re-export Json for consumers
export type { Json };

// ─────────────────────────────────────────────────────────────────────
// Table type aliases (canonical contract lives in database.types.ts)
// ─────────────────────────────────────────────────────────────────────

export type User = Tables<"users">;

export type SocialAccount = Tables<"social_accounts">;

export type AnalyticsMetric = Tables<"analytics_metrics">;

export type StripeSubscription = Tables<"stripe_subscriptions">;

export type Wallet = Tables<"wallets">;

export type ScheduledPost = Tables<"scheduled_posts"> & {
  social_accounts?: SocialAccountAccessible | null;
};

export type ContentHistory = Tables<"content_history"> & {
  social_accounts?: { avatar_url: string | null } | null;
};

export type PendingTikTokPull = Tables<"pending_tiktok_pulls">;

// ─────────────────────────────────────────────────────────────────────
// Enum types
// ─────────────────────────────────────────────────────────────────────

export type Platform =
  | "linkedin"
  | "tiktok"
  | "pinterest"
  | "instagram"
  | "facebook"
  | "threads"
  | "youtube"
  | "x";

export type PostStatus =
  | "scheduled"
  | "processing"
  | "posted"
  | "failed"
  | "cancelled";

export type MediaType = "video" | "image" | "text";

export type SubscriptionStatus =
  | "active"
  | "canceled"
  | "past_due"
  | "trialing"
  | "incomplete";

// ─────────────────────────────────────────────────────────────────────
// Platform-specific option types
// ─────────────────────────────────────────────────────────────────────

export type PrivacyLevel =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "FOLLOWER_OF_CREATOR"
  | "SELF_ONLY"
  | "PUBLIC"
  | "PROTECTED";

export interface TikTokOptions {
  privacyLevel?: PrivacyLevel;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  // FIX TIKTOK-COMPLIANCE additions:
  brandContentToggle?: boolean;
  yourBrand?: boolean;
  brandedContent?: boolean;
  isAigc?: boolean;
}

export interface PinterestOptions {
  privacyLevel: PrivacyLevel;
  board: string;
  link: string;
}

export interface LinkedinOptions {
  visibility: string;
}

export interface PlatformOptions {
  caption?: string;
  scheduledAt?: Date;
  tiktok?: TikTokOptions;
  pinterest?: PinterestOptions;
  facebook?: { privacyLevel: string };
  linkedin?: LinkedinOptions;
}

// ─────────────────────────────────────────────────────────────────────
// Social account helpers
// ─────────────────────────────────────────────────────────────────────

export interface SocialProfile {
  id?: string;
  username?: string;
  display_name?: string;
  avatar_url?: string;
  is_verified?: boolean;
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

export interface SocialAccountExtra {
  profile?: SocialProfile;
  token_info?: TokenInfo;
  connection_status?: ConnectionStatus;
}

export interface SocialAccountAccessible {
  length?: number;
  [index: number]: { avatar_url?: string; display_name?: string };
  avatar_url?: string;
  display_name?: string;
}

// ─────────────────────────────────────────────────────────────────────
// API Request/Response types
// ─────────────────────────────────────────────────────────────────────

export interface TokenExchangeResponse {
  error?: string;
  token_type?: string;
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  refresh_expires_in?: string;
  scope?: string;
  user_id?: string;
  open_id?: string;
}

export interface InstagramProfile {
  id: string;
  username: string;
  name: string;
  account_type: "PERSONAL" | "BUSINESS" | "CREATOR";
  profile_picture_url: string;
  followers_count: number | null;
  follows_count: number | null;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}
