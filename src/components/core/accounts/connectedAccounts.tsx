"use client";

import { adminSupabase } from "@/actions/api/supabase";
import { Provider } from "@/actions/types/provider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { auth } from "@clerk/nextjs/server";
import { AlertCircle, RefreshCw, Unlink, UserCheck, Users } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { toast } from "sonner";

// Define types for the extra JSON field
interface SocialProfile {
  id: string;
  username: string;
  avatar_url?: string;
  is_verified?: boolean;
  display_name?: string;
  follower_count?: number;
  following_count?: number;
  bio_description?: string;
}

interface TokenInfo {
  scope?: string;
  token_type?: string;
  refresh_expires_in?: number;
}

interface ConnectionStatus {
  connected_at?: string;
  profile_fetch_successful?: boolean;
}

interface ExtraData {
  profile?: SocialProfile;
  token_info?: TokenInfo;
  connection_status?: ConnectionStatus;
}

// Extend the social_accounts table type from the database schema
interface SocialAccount {
  id: string;
  user_id: string;
  platform: Provider;
  account_identifier: string;
  access_token: string;
  refresh_token?: string | null;
  token_expires_at?: string | null;
  extra?: ExtraData;
  created_at: string;
  updated_at: string;
}

export default function ConnectedAccounts() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAccounts = async () => {
    setLoading(true);
    setError(null);

    try {
      // Get the current user's ID from Clerk
      const { userId } = await auth();

      if (!userId) {
        throw new Error("Utilisateur non authentifié");
      }

      // Fetch social accounts for the current user, filtered by platform
      const { data, error } = await adminSupabase
        .from("social_accounts")
        .select("*")
        .eq("user_id", userId)
        .eq("platform", "tiktok");

      if (error) throw error;

      setAccounts(data || []);
    } catch (err) {
      console.error("Erreur lors du chargement des comptes:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Impossible de charger les comptes connectés. Veuillez réessayer plus tard."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const disconnectAccount = async (accountId: string) => {
    try {
      // Remove the account from the social_accounts table
      const { error } = await adminSupabase
        .from("social_accounts")
        .delete()
        .eq("id", accountId);

      if (error) throw error;

      // Remove account from local state
      setAccounts((prevAccounts) =>
        prevAccounts.filter((account) => account.id !== accountId)
      );
      toast.success("Compte déconnecté avec succès");
    } catch (error) {
      console.error("Erreur lors de la déconnexion", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Impossible de déconnecter le compte. Veuillez réessayer plus tard."
      );
    }
  };

  if (loading) {
    return (
      <div>
        <h2 className="text-xl font-bold mb-4">Comptes TikTok Connectés</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center">
                <Skeleton className="w-12 h-12 rounded-full mr-4" />
                <div className="flex-1">
                  <Skeleton className="h-5 w-32 mb-2" />
                  <Skeleton className="h-4 w-48" />
                </div>
              </div>
              <div className="mt-4">
                <Skeleton className="h-9 w-28" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className="mb-6">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Erreur</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={fetchAccounts}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Réessayer
        </Button>
      </Alert>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="text-center p-8 border rounded-lg bg-muted/30">
        <Users className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">
          Aucun compte TikTok connecté
        </h3>
        <p className="text-muted-foreground mb-4">
          Connectez votre compte TikTok pour commencer à publier du contenu sur
          cette plateforme.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Comptes TikTok Connectés</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {accounts.map((account) => {
          // Extract profile from extra if available
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
                    <Badge variant="outline" className="bg-primary/10">
                      TikTok
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
                            {profile.following_count.toLocaleString()}{" "}
                            abonnements
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

              <CardFooter className="border-t pt-3 gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => disconnectAccount(account.id)}
                >
                  <Unlink className="mr-1 h-4 w-4" />
                  Déconnecter
                </Button>

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
    </div>
  );
}
