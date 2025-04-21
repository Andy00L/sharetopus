// src/components/core/accounts/social/SocialAccountCard.tsx
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConnectionStatus, SocialAccount } from "@/lib/types/dbTypes";

import AvatarWithFallback from "../../../AvatarWithFallback";

interface Props {
  readonly account: SocialAccount;
}

export default function SocialAccountCard({ account }: Props) {
  /* ---------- helpers ---------- */
  const connectionStatus: Partial<ConnectionStatus> =
    account.extra?.connection_status ?? {};

  const connectedAt =
    connectionStatus.connected_at &&
    typeof connectionStatus.connected_at === "string"
      ? new Date(connectionStatus.connected_at).toLocaleDateString()
      : "Date inconnue";

  /* ---------- JSX ---------- */
  return (
    <Card key={account.id} className="overflow-hidden">
      <CardHeader className="bg-muted/30 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-primary/10 capitalize">
              {account.platform}
            </Badge>

            {account.is_verified && (
              <Badge className="bg-blue-500">Vérifié</Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-full overflow-hidden bg-muted flex items-center justify-center">
            <AvatarWithFallback
              src={account.avatar_url}
              alt={account.display_name ?? `Utilisateur ${account.platform}`}
              className="h-full w-full"
            />
          </div>

          <div className="flex-1">
            <h3 className="font-semibold text-lg">
              {account.display_name ?? `Utilisateur ${account.platform}`}
            </h3>
            <p className="text-sm text-muted-foreground">
              @{account.username ?? account.account_identifier.substring(0, 8)}
            </p>
            <div className="flex gap-4 mt-2 text-sm">
              <span>{account.follower_count} abonnés</span>
              <span>{account.following_count} abonnements</span>
            </div>
          </div>
        </div>

        {account.bio_description && (
          <div className="mt-3 text-sm">
            <p className="line-clamp-2">{account.bio_description}</p>
          </div>
        )}

        <div className="mt-3 text-xs text-muted-foreground">
          Connecté le {connectedAt}
        </div>
      </CardContent>
    </Card>
  );
}
