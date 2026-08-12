import type { ClientSocialAccount, SocialAccount } from "@/lib/types/dbTypes";

/**
 * Projects a full social_accounts row to the client-safe shape. Pages call
 * this before passing accounts into client components so token columns
 * never serialize into the RSC payload. Explicit field list on purpose: a
 * spread would silently start leaking any column added to the table later.
 */
export function toClientSocialAccount(
  account: SocialAccount,
): ClientSocialAccount {
  return {
    id: account.id,
    platform: account.platform,
    username: account.username,
    display_name: account.display_name,
    avatar_url: account.avatar_url,
    account_identifier: account.account_identifier,
    is_verified: account.is_verified,
  };
}
