// src/components/core/accounts/social/ConnectedAccountsClient.tsx
"use client"; // Keep this component as a client component

import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button"; // Keep for potential future actions
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import {
  SocialAccount,
  SocialProfile,
  ConnectionStatus,
  TokenInfo,
} from "@/actions/types/socialAccount";
import { Users, UserCheck } from "lucide-react";
// Import shared types

// Define props for the client component
interface ConnectedAccountsClientProps {
  readonly initialAccounts: SocialAccount[];
  // You could potentially pass down error messages from the server fetch too
  // fetchError?: string | null;
}

export default function ConnectedAccountsClient({
  initialAccounts,
}: // fetchError
ConnectedAccountsClientProps) {
  // Directly use the prop. No local state needed for the list itself
  // if updates rely solely on page refresh passing new props.
  const accounts = initialAccounts;

  // Removed handleDisconnect and related state

  // Optional: Display server-side fetch error if passed
  // if (fetchError) {
  //   return (
  //     <Alert variant="destructive" className="mb-6">
  //       <AlertCircle className="h-4 w-4" />
  //       <AlertTitle>Erreur de chargement</AlertTitle>
  //       <AlertDescription>{fetchError}</AlertDescription>
  //     </Alert>
  //   );
  // }

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
    // Removed the outer H2 as it's now in the parent server component
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {accounts.map((account) => {
        // Use Partial to provide a fallback type for profile, connectionStatus, and tokenInfo
        const profile: Partial<SocialProfile> = account.extra?.profile ?? {};
        const connectionStatus: Partial<ConnectionStatus> =
          account.extra?.connection_status ?? {};
        const tokenInfo: Partial<TokenInfo> = account.extra?.token_info ?? {};

        // Check for limited permissions
        const hasLimitedPermissions =
          profile.bio_description?.includes("limited permissions") ||
          !tokenInfo.scope?.includes("user.info.basic");

        const connectedAt = connectionStatus.connected_at
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
                  {profile.is_verified && (
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
                  {profile.avatar_url ? (
                    <Image
                      src={profile.avatar_url}
                      alt={profile.display_name ?? "Utilisateur TikTok"}
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
                    {profile.display_name ?? "Utilisateur TikTok"}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    @
                    {profile.username ??
                      account.account_identifier.substring(0, 8)}
                  </p>
                  {(profile.follower_count !== undefined ||
                    profile.following_count !== undefined) && (
                    <div className="flex gap-4 mt-2 text-sm">
                      {profile.follower_count !== undefined && (
                        <span>
                          {profile.follower_count.toLocaleString()} abonnés
                        </span>
                      )}
                      {profile.following_count !== undefined && (
                        <span>
                          {profile.following_count.toLocaleString()} abonnements
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {profile.bio_description && !hasLimitedPermissions && (
                <div className="mt-3 text-sm">
                  <p className="line-clamp-2">{profile.bio_description}</p>
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
