// src/components/core/accounts/social/ConnectedAccountsClient.tsx

import { SocialAccount } from "@/lib/types/dbTypes";

import SocialAccountBadge from "./SocialAccountBadge";

interface ConnectedAccountsClientProps {
  readonly initialAccounts: SocialAccount[];
  readonly userId: string | null;
}

export default function ConnectedAccountsClient({
  initialAccounts,
  userId,
}: ConnectedAccountsClientProps) {
  const accounts = initialAccounts;
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
