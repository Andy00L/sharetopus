// components/ConnectedAccounts.tsx
"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface TikTokAccount {
  id: string;
  account_identifier: string;
  username: string;
  extra: {
    profile_image_url?: string;
    [key: string]: unknown;
  };
}

interface AccountsResponse {
  accounts: TikTokAccount[];
}

export default function ConnectedAccounts() {
  const [accounts, setAccounts] = useState<TikTokAccount[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    async function fetchAccounts() {
      try {
        const res = await fetch("/api/social/accounts?tiktok=true");
        if (res.ok) {
          const data: AccountsResponse = await res.json();
          setAccounts(data.accounts);
        } else {
          console.error("Erreur lors du chargement des comptes TikTok");
        }
      } catch (error) {
        console.error("Erreur dans fetchAccounts", error);
      } finally {
        setLoading(false);
      }
    }
    fetchAccounts();
  }, []);

  if (loading) {
    return <p>Chargement des comptes connectés…</p>;
  }

  if (accounts.length === 0) {
    return <p>Aucun compte TikTok connecté.</p>;
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Comptes TikTok Connectés</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {accounts.map((account) => (
          <Card key={account.id} className="p-4">
            <div className="flex items-center">
              {account.extra?.profile_image_url && (
                <Image
                  src={account.extra.profile_image_url}
                  alt={account.username}
                  className="w-12 h-12 rounded-full mr-4"
                />
              )}
              <div>
                <p className="font-semibold">{account.username}</p>
                <p className="text-sm text-muted-foreground">
                  ID : {account.account_identifier}
                </p>
              </div>
            </div>
            <div className="mt-2">
              <Button variant="outline" size="sm">
                Déconnecter
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
