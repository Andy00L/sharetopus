"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertCircle,
  CheckCircle,
  Info,
  Loader2,
  TrendingUp,
  Facebook,
  Instagram,
  Youtube,
} from "lucide-react";
import { SocialMediaAccount } from "@/actions/types/SocialMediaAccount ";
import { getAllSocialAccounts } from "@/actions/server/supabase/getAllSocialAccounts";
import { ConnectTikTokButton } from "@/components/core/account/ConnectButton";

// SVG for TikTok icon
const TikTokIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
  </svg>
);

// SVG for Threads icon
const ThreadsIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.7 7.7c-1-1-2.5-1.5-4.1-1.5-3.2 0-5.8 2.2-5.8 5.8 0 .5 0 .9.1 1.4-4.8-.2-8.9-2.5-11.7-6-.5.8-.8 1.8-.8 2.9 0 2 1 3.8 2.6 4.8-.9 0-1.8-.3-2.6-.7v.1c0 2.8 2 5.1 4.6 5.6-.5.1-1 .2-1.5.2-.4 0-.7 0-1-.1.7 2.3 2.9 3.9 5.4 4-2 1.5-4.4 2.5-7.1 2.5-.5 0-.9 0-1.4-.1 2.5 1.6 5.6 2.5 8.8 2.5 10.6 0 16.3-8.7 16.3-16.3v-.7c1.1-.8 2.1-1.8 2.9-3-.9.4-2 .7-3.1.9 1.1-.7 2-1.8 2.4-3.1-1.1.6-2.3 1.1-3.5 1.3-1-1.1-2.5-1.8-4.1-1.8-3.1 0-5.6 2.5-5.6 5.6 0 .4 0 .9.1 1.3-4.7-.2-8.9-2.5-11.7-5.9-.5.8-.8 1.8-.8 2.9 0 1.9 1 3.7 2.5 4.7-.9 0-1.8-.3-2.5-.7 0 2.7 1.9 5 4.5 5.5-.5.1-1 .2-1.5.2-.4 0-.7 0-1-.1.7 2.2 2.9 3.8 5.4 4-2 1.6-4.4 2.5-7.1 2.5-.5 0-.9 0-1.4-.1 2.6 1.6 5.6 2.6 8.9 2.6 10.7 0 16.5-8.9 16.5-16.5v-.8c1.1-.8 2.1-1.9 2.9-3.1-1.1.5-2.2.8-3.4 1 1.2-.7 2.1-1.8 2.6-3.2-1.1.7-2.4 1.1-3.7 1.4z" />
  </svg>
);

// Platform configuration with icons
const platformConfig = {
  tiktok: {
    name: "TikTok",
    icon: TikTokIcon,
    connectButton: ConnectTikTokButton,
    color: "bg-black",
  },
  instagram: {
    name: "Instagram",
    icon: Instagram,
    connectButton: () => <Button disabled>Coming Soon</Button>,
    color: "bg-[#E1306C]",
  },
  facebook: {
    name: "Facebook",
    icon: Facebook,
    connectButton: () => <Button disabled>Coming Soon</Button>,
    color: "bg-[#1877F2]",
  },
  threads: {
    name: "Threads",
    icon: ThreadsIcon,
    connectButton: () => <Button disabled>Coming Soon</Button>,
    color: "bg-black",
  },
  youtube: {
    name: "YouTube",
    icon: Youtube,
    connectButton: () => <Button disabled>Coming Soon</Button>,
    color: "bg-[#FF0000]",
  },
};

export default function ManageAccountsPage() {
  const { user, isLoaded: isUserLoaded, isSignedIn } = useUser();
  const [accounts, setAccounts] = useState<SocialMediaAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAccounts() {
      if (!isUserLoaded || !isSignedIn) return;

      try {
        setIsLoading(true);
        const userAccounts = await getAllSocialAccounts(user.id);
        setAccounts(userAccounts);
      } catch (err) {
        console.error("Error fetching social accounts:", err);
        setError(
          "Failed to load your connected accounts. Please try again later."
        );
      } finally {
        setIsLoading(false);
      }
    }

    fetchAccounts();
  }, [user?.id, isUserLoaded, isSignedIn]);

  const getAccountStatus = (account: SocialMediaAccount | undefined) => {
    if (!account) {
      return {
        status: "Not connected",
        badge: <Badge variant="outline">Not Connected</Badge>,
      };
    }

    if (!account.enabled) {
      return {
        status: "Disabled",
        badge: <Badge variant="secondary">Disabled</Badge>,
      };
    }

    // Check if token is expired
    const isExpired =
      account.expires_at && new Date(account.expires_at) < new Date();
    if (isExpired) {
      return {
        status: "Token expired",
        badge: <Badge variant="destructive">Token Expired</Badge>,
      };
    }

    return {
      status: "Connected",
      badge: (
        <Badge variant="default" className="bg-green-500">
          Connected
        </Badge>
      ),
    };
  };

  if (!isUserLoaded || !isSignedIn) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6">
      <header className="mb-8">
        <h1 className="text-2xl font-bold">Manage Social Media Accounts</h1>
        <p className="text-muted-foreground mt-2">
          Connect your social media accounts to publish content across
          platforms.
        </p>
      </header>

      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <p>{error}</p>
        </div>
      )}

      <Tabs defaultValue="all">
        <TabsList className="mb-6">
          <TabsTrigger value="all">All Platforms</TabsTrigger>
          <TabsTrigger value="connected">Connected</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-6">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {Object.entries(platformConfig).map(([provider, config]) => {
                const account = accounts.find(
                  (acc) => acc.provider === provider
                );
                const { badge } = getAccountStatus(account);
                const ConnectButton = config.connectButton;

                return (
                  <Card key={provider} className="overflow-hidden">
                    <CardHeader className="pb-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className={`p-2 rounded-md ${config.color} text-white`}
                          >
                            <config.icon />
                          </div>
                          <CardTitle className="text-lg">
                            {config.name}
                          </CardTitle>
                        </div>
                        {badge}
                      </div>
                      <CardDescription>
                        {account ? (
                          <span>
                            Connected as:{" "}
                            {account.username ??
                              account.display_name ??
                              "Unknown User"}
                          </span>
                        ) : (
                          <span>
                            Connect your {config.name} account to share content
                          </span>
                        )}
                      </CardDescription>
                    </CardHeader>

                    <CardContent>
                      <div className="flex justify-between items-center">
                        <div>
                          {account && account.enabled && (
                            <div className="flex items-center text-xs text-muted-foreground gap-1">
                              <CheckCircle className="h-3 w-3 text-green-500" />
                              <span>Ready to publish</span>
                            </div>
                          )}
                        </div>

                        <ConnectButton />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="connected">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : accounts.filter((acc) => acc.enabled).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Info className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">
                No Connected Accounts
              </h3>
              <p className="text-muted-foreground max-w-md mb-6">
                You haven`&apos;`t connected any social media accounts yet.
                Connect your first account to start sharing content.
              </p>
              <ConnectTikTokButton />
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {accounts
                .filter((acc) => acc.enabled)
                .map((account) => {
                  const config =
                    platformConfig[
                      account.provider as keyof typeof platformConfig
                    ];
                  if (!config) return null;

                  return (
                    <Card key={account.id} className="overflow-hidden">
                      <CardHeader className="pb-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div
                              className={`p-2 rounded-md ${config.color} text-white`}
                            >
                              <config.icon />
                            </div>
                            <CardTitle className="text-lg">
                              {config.name}
                            </CardTitle>
                          </div>
                          <Badge variant="default" className="bg-green-500">
                            Connected
                          </Badge>
                        </div>
                        <CardDescription>
                          Connected as:{" "}
                          {account.username ??
                            account.display_name ??
                            "Unknown User"}
                        </CardDescription>
                      </CardHeader>

                      <CardContent>
                        <div className="flex flex-col gap-3">
                          <div className="flex items-center text-xs text-muted-foreground gap-1">
                            <CheckCircle className="h-3 w-3 text-green-500" />
                            <span>Ready to publish</span>
                          </div>

                          <div className="flex items-center text-xs text-muted-foreground gap-1">
                            <TrendingUp className="h-3 w-3" />
                            <span>
                              Account connected on{" "}
                              {new Date(
                                account.created_at
                              ).toLocaleDateString()}
                            </span>
                          </div>

                          <div className="mt-4">
                            <Button variant="outline" size="sm">
                              Disconnect
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <div className="mt-12 border-t pt-6">
        <h2 className="text-lg font-medium mb-4">
          Need help connecting accounts?
        </h2>
        <p className="text-muted-foreground mb-6">
          If youre experiencing issues connecting your social media accounts,
          check our troubleshooting guide or contact support.
        </p>
        <div className="flex gap-4">
          <Button variant="outline">View Troubleshooting Guide</Button>
          <Button variant="secondary">Contact Support</Button>
        </div>
      </div>
    </div>
  );
}
