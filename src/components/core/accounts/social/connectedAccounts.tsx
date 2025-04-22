// src/components/core/accounts/social/ConnectedAccountsClient.tsx

import { SocialAccount } from "@/lib/types/dbTypes";

import NoAccountsMessage from "./NoAccountsMessage";
import SocialAccountCard from "./SocialAccountCard";

interface ConnectedAccountsClientProps {
  readonly initialAccounts: SocialAccount[];
}

export default function ConnectedAccountsClient({
  initialAccounts,
}: ConnectedAccountsClientProps) {
  const accounts = initialAccounts;

  if (!accounts || accounts.length === 0) {
    return <NoAccountsMessage />;
  }
  /* ---------- list of cards ---------- */
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {accounts.map((account) => (
        <SocialAccountCard key={account.id} account={account} />
      ))}
    </div>
  );
}
