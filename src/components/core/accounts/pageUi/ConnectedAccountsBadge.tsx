import { ClientSocialAccount } from "@/lib/types/dbTypes";

import SocialAccountBadge from "./SocialAccountBadge";

interface ConnectedAccountsProps {
  readonly accounts: ClientSocialAccount[];
  readonly userId: string | null;
}

export default function ConnectedAccountsBadge({
  accounts,
  userId,
}: ConnectedAccountsProps) {
  if (!userId) {
    return null;
  }
  if (accounts.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {accounts.map((account) => (
        <SocialAccountBadge key={account.id} account={account} />
      ))}
    </div>
  );
}
