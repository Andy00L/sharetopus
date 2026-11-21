import type { social_accounts } from "@/db/schema";
import type { ConnectionDTO } from "@/lib/api/rest/openapi/responseSchemas";

type SocialAccountRow = typeof social_accounts.$inferSelect;

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
