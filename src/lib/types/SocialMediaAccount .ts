import { Provider } from "./provider";

export type SocialMediaAccount = {
  id: string;
  user_id: string;
  provider: Provider;
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
