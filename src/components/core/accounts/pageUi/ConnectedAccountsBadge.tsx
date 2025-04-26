// src/components/core/accounts/social/ConnectedAccounts.tsx

import { SocialAccount } from "@/lib/types/dbTypes";

import SocialAccountBadge from "./SocialAccountBadge";

interface ConnectedAccountsProps {
  readonly accounts: SocialAccount[];
  readonly userId: string | null;
}

export default function ConnectedAccountsBadge({
  accounts,
  userId,
}: ConnectedAccountsProps) {
  if (!userId) {
    return null;
  }
  if (!accounts || accounts.length === 0) {
    return null; // No message needed as we're showing badges inline
  }

  /* ---------- list of cards ---------- */
  return (
    <div className="flex flex-wrap gap-2 items-center">
      {accounts.map((account) => (
        <SocialAccountBadge
          key={account.id}
          account={account}
          userId={userId}
        />
      ))}
    </div>
  );
}
