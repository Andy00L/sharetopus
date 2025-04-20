// src/components/core/accounts/social/ConnectedAccountsClient.tsx
"use client"; // Keep this component as a client component

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button"; // Keep for potential future actions
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import {
  ConnectionStatus,
  SocialAccount,
  TokenInfo,
} from "@/lib/types/dbTypes";

import { UserCheck, Users } from "lucide-react";
import Image from "next/image";

interface ConnectedAccountsClientProps {
  readonly initialAccounts: SocialAccount[];
}

export default function ConnectedAccountsClient({
  initialAccounts,
}: // fetchError
ConnectedAccountsClientProps) {
  const accounts = initialAccounts;

  if (!accounts || accounts.length === 0) {
    return (
      <div className="text-center p-8 border rounded-lg bg-muted/30">
        <Users className="mx-auto h-12 w-12 text-muted-foreground mb-4" />+{" "}
        <h3 className="text-lg font-medium mb-2">
          Aucun compte social connecté
        </h3>
        +{" "}
        <p className="text-muted-foreground mb-4">
          Connectez vos comptes sociaux pour les gérer ici.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {accounts.map((account) => {
        const connectionStatus: Partial<ConnectionStatus> =
          account.extra?.connection_status ?? {};
        const tokenInfo: Partial<TokenInfo> = account.extra?.token_info ?? {};

        const hasLimitedPermissions = // Also check for fetch errors
          !tokenInfo.scope?.includes("user.info.profile"); // Check for profile scope specifically

        const connectedAt =
          connectionStatus.connected_at &&
          typeof connectionStatus.connected_at === "string"
            ? new Date(connectionStatus.connected_at).toLocaleDateString()
            : "Date inconnue";

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
                  {hasLimitedPermissions && (
                    <Badge
                      variant="outline"
                      className="text-amber-500 border-amber-500"
                    >
                      Permissions limitées
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-full overflow-hidden bg-muted flex items-center justify-center">
                  {account.avatar_url ? (
                    <Image
                      src={account.avatar_url}
                      alt={
                        account.display_name ??
                        `Utilisateur ${account.platform}`
                      }
                      width={64}
                      height={64}
                      className="object-cover"
                      // Add error handling for images if needed
                      onError={(e) => {
                        // Handle image load error, e.g., show placeholder
                        (e.target as HTMLImageElement).style.display = "none";
                        // You might want a placeholder element to show instead
                      }}
                    />
                  ) : (
                    <UserCheck className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">
                    {account.display_name ?? `Utilisateur ${account.platform}`}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    @
                    {account.username ??
                      account.account_identifier.substring(0, 8)}
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
            {/* Footer can be kept for future actions like "View Details" or "Refresh Permissions" */}
            <CardFooter className="border-t pt-3 gap-2 flex-wrap">
              {/* Removed Disconnect button as requested */}
              {/* Example: Button for future use */}
              {/* <Button variant="ghost" size="sm">Details</Button> */}
              {hasLimitedPermissions && (
                <Button variant="secondary" size="sm" className="flex-1">
                  Mettre à niveau les permissions
                </Button>
              )}
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}
