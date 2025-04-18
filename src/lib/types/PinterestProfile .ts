// lib/types/PinterestProfile.ts
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
};
