import type {
  content_history,
  pending_tiktok_pulls,
  scheduled_posts,
  social_accounts,
} from "@/db/schema";

// Re-export for consumers
export type { Json, MediaType } from "@/db/schema";

// ─────────────────────────────────────────────────────────────────────
// Table type aliases (row shapes inferred from the Drizzle tables in
// src/db/schema.ts)
// ─────────────────────────────────────────────────────────────────────

export type SocialAccount = typeof social_accounts.$inferSelect;

/**
 * The social_accounts projection that may cross to client components.
 * Deliberately excludes access_token, refresh_token, and expiry columns:
 * full rows serialized into RSC payloads put tokens in the page source.
 * Server code resolves tokens by account id (ensureValidToken); the
 * client never holds one. Full rows satisfy this type structurally, so
 * server-only call sites keep working unchanged.
 */
export type ClientSocialAccount = Pick<
  SocialAccount,
  | "id"
  | "platform"
  | "username"
  | "display_name"
  | "avatar_url"
  | "account_identifier"
  | "is_verified"
>;

/**
 * The exact projection getScheduledPosts selects for list surfaces (web
 * grid, calendar, MCP list, x402 list). Narrower than the full row on
 * purpose: the query never reads the remaining columns, so typing them
 * present would lie to consumers. sourceRef:
 * src/actions/server/scheduleActions/getScheduledPosts.ts (select string).
 */
export type ScheduledPostListItem = Pick<
  typeof scheduled_posts.$inferSelect,
  | "id"
  | "scheduled_at"
  | "status"
  | "platform"
  | "post_title"
  | "post_description"
  | "error_message"
  | "media_type"
  | "media_storage_path"
  | "batch_id"
  | "created_via"
> & {
  social_accounts: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
};

export type ContentHistory = typeof content_history.$inferSelect & {
  social_accounts?: { avatar_url: string | null } | null;
};

export type PendingTikTokPull = typeof pending_tiktok_pulls.$inferSelect;

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

export interface YouTubeOptions {
  /** videos.insert status.privacyStatus. sourceRef: postToYouTube.ts */
  privacyStatus?: "public" | "unlisted" | "private";
}

export interface PlatformOptions {
  caption?: string;
  scheduledAt?: Date;
  tiktok?: TikTokOptions;
  pinterest?: PinterestOptions;
  facebook?: { privacyLevel: string };
  linkedin?: LinkedinOptions;
  youtube?: YouTubeOptions;
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

export type TokenExchangeResult =
  | { success: true; data: TokenExchangeResponse }
  | { success: false; message: string };

export interface InstagramProfile {
  id: string;
  username: string;
  name: string;
  account_type: "PERSONAL" | "BUSINESS" | "CREATOR";
  profile_picture_url: string;
  followers_count: number | null;
  follows_count: number | null;
}
