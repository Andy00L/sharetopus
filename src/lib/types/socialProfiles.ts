// ----- LinkedIn -----

export interface LinkedInProfile {
  id: string;
  name: string;
  given_name: string;
  family_name: string;
  email: string;
  picture: string;
  locale: string;
  email_verified: boolean;
}

// ----- Pinterest -----

export type PinterestProfile = {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  full_name: string;
  profile_image_url: string | null;
  follower_count: number | null;
  following_count: number | null;
  is_verified: boolean;
  bio: string | null;
  business_name: string | null;
};

// ----- TikTok -----

/**
 * Represents a TikTok user profile as returned by the TikTok API
 */
export type TikTokProfile = {
  /**
   * User's open_id or unique identifier on TikTok
   */
  id?: string;

  /**
   * User's username (display_name if username not available)
   */
  username: string;

  /**
   * User's display name
   */
  display_name: string;

  /**
   * URL to the user's profile picture
   */
  avatar_url: string | null;

  /**
   * Whether the user has a verified badge
   */
  is_verified: boolean;

  /**
   * User's bio description
   */
  bio_description: string | null;

  /**
   * Count of followers
   */
  follower_count: number | null;

  /**
   * Count of accounts the user is following
   */
  following_count: number | null;
};
