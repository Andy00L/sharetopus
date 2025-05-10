// Enum types
export type Platform =
  | "tiktok"
  | "instagram"
  | "facebook"
  | "threads"
  | "youtube"
  | "pinterest";
export type PostStatus =
  | "scheduled"
  | "processing"
  | "posted"
  | "failed"
  | "cancelled"
  | "idle"
  | "validating"
  | "uploading_media"
  | "scheduling"
  | "success"
  | "error";
export type MediaType = "video" | "image" | "text";
export type SubscriptionStatus =
  | "active"
  | "canceled"
  | "past_due"
  | "trialing"
  | "incomplete";

// Platform-specific option types
export type PrivacyLevel =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "SELF_ONLY"
  | "PUBLIC"
  | "PROTECTED";

export interface TikTokOptions {
  privacyLevel: PrivacyLevel;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
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
  instagram?: { privacyLevel: string };
  facebook?: { privacyLevel: string };
  linkedin?: LinkedinOptions;
}

// Social account extra data structure
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

// Main database tables
export interface User {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
  updated_at: string;
  stripe_customer_id: string;
  // Relations (optional for type safety in joins)
  analytics_metrics?: AnalyticsMetric[];
  content_history?: ContentHistory[];
  scheduled_posts?: ScheduledPost[];
  social_accounts?: SocialAccount[];
  stripe_events?: StripeEvent[];
  stripe_subscriptions?: StripeSubscription[];
}

export interface SocialAccount {
  id: string;
  user_id: string;
  platform: string; // Using string instead of Platform for flexibility
  account_identifier: string;
  access_token: string | null;
  refresh_token: string | null;
  is_availble: boolean;
  token_expires_at: string | null;
  extra: SocialAccountExtra | null;
  created_at: string | null;
  updated_at: string | null;
  username: string | null;
  avatar_url: string | null;
  is_verified: boolean | null; // Note: This is string in your schema, not boolean
  display_name: string | null;
  follower_count: string | null;
  following_count: string | null;
  bio_description: string | null;

  // Relations
  scheduled_posts?: ScheduledPost[];
  users?: User;
}

//=============================================
//schedualing
//=============================================
export interface SocialAccountAccessible {
  // Array-like properties
  length?: number;
  [index: number]: { avatar_url?: string; display_name?: string };

  // Direct object properties your components are accessing
  avatar_url?: string;
  display_name?: string;
}
export interface ScheduledPost {
  id: string;
  user_id?: string;
  social_account_id?: string;
  platform: string;
  status: PostStatus;
  scheduled_at: string;
  posted_at?: string | null;
  post_title?: string | null;
  post_description: string | null;
  post_options?: PlatformOptions | null;
  media_type: string;
  media_storage_path?: string;
  error_message: string | null;
  created_at?: string;
  updated_at?: string;
  batch_id: string;
  // Relations
  social_accounts?: SocialAccountAccessible;

  users?: User;
}

//=============================================
export interface AnalyticsMetric {
  id: string;
  user_id: string;
  platform: string;
  content_id: string | null;
  views: bigint | null;
  comments: bigint | null;
  subscribers: bigint | null;
  extra: string | null;
  created_at: string;
  updated_at: string;

  // Relations
  users?: User;
}

export interface ContentHistory {
  id?: string;
  user_id?: string;
  platform: string;
  content_id: string;
  title: string | null;
  description: string | null;
  media_url: string | null;
  extra: Record<string, unknown> | null;
  created_at?: string;
  batch_id: string;
  status?: string;
  media_type: string | null;
  social_account_id: string;
  social_accounts?: {
    avatar_url: string | null;
  };
  // Relations
  users?: User;
}

export interface StripeSubscription {
  id: string;
  stripe_subscription_id: string;
  stripe_customer_id: string;
  stripe_price_id: string;
  plan: string;
  status: SubscriptionStatus;
  start_date: string;
  current_period_end: string;
  cancel_reason: string | null;
  amount: number;
  currency: string;
  is_active: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  user_id: string;

  // Relations
  users?: User;
}

export interface StripeEvent {
  id: string;
  stripe_event_id: string;
  user_id: string | null;
  event_type: string;
  data: string;
  created_at: string;

  // Relations
  users?: User | null;
}

// API Request/Response types
export interface SchedulePostData {
  socialAccountId: string;
  platform: string;
  scheduledAt: string | Date;
  title: string | null;
  mediaType: MediaType;
  mediaStoragePath: string;
  postOptions: PlatformOptions | null;
}

export interface TokenExchangeResponse {
  error: string;
  token_type: string;
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  refresh_expires_in?: string;
  scope?: string;
  user_id: string;
  open_id?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}
