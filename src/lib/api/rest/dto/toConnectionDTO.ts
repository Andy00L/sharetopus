import type { Database } from "@/lib/types/database.types";

type SocialAccountRow =
  Database["public"]["Tables"]["social_accounts"]["Row"];

/**
 * Public DTO for a connected social account. Tokens and internal
 * fields are stripped. Explicit field-by-field copy prevents leaking
 * new columns added to social_accounts.
 *
 * Excluded: access_token, refresh_token, extra, email_address,
 * deleted_at, connection_id, following_count, bio_description,
 * updated_at.
 */
export type ConnectionDTO = {
  id: string;
  platform: string;
  account_identifier: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  is_verified: boolean | null;
  follower_count: number | null;
  is_available: boolean;
  token_expires_at: string | null;
  created_at: string;
};

export function toConnectionDTO(row: SocialAccountRow): ConnectionDTO {
  return {
    id: row.id,
    platform: row.platform,
    account_identifier: row.account_identifier,
    display_name: row.display_name,
    username: row.username,
    avatar_url: row.avatar_url,
    is_verified: row.is_verified,
    follower_count: row.follower_count,
    is_available: row.is_available,
    token_expires_at: row.token_expires_at,
    created_at: row.created_at,
  };
}
