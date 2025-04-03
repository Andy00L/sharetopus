import { PostStatus } from "./PostStatus ";
import { Provider } from "./provider";

export type SocialMediaPost = {
  id: string;
  user_id: string;
  provider: Provider;
  provider_post_id?: string;
  caption: string;
  media_url?: string;
  thumbnail_url?: string;
  status: PostStatus;
  scheduled_for?: string;
  published_at?: string;
  failure_reason?: string;
  created_at: string;
  updated_at: string;
  metadata?: string;
};
