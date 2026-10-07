"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createRestApiKey } from "@/actions/server/api/createRestApiKey";
import { revokeRestApiKey } from "@/actions/server/api/revokeRestApiKey";
import { createApiKey } from "@/actions/server/mcp/createApiKey";
import { revokeApiKey } from "@/actions/server/mcp/revokeApiKey";
import {
  API_KEY_EXPIRY_DAYS_OPTIONS,
  DEFAULT_API_KEY_EXPIRY_DAYS,
  isValidApiKeyExpiryDays,
  type ApiKeyExpiryDays,
} from "@/lib/mcp/apiKeyExpiry";

type CardKeyKind = "mcp" | "rest";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

const CARD_COPY: Record<
  CardKeyKind,
  { title: string; description: string; namePlaceholder: string; emptyText: string }
> = {
  mcp: {
    title: "MCP API Keys",
    description: "Keys for connecting AI clients to Sharetopus via the Model Context Protocol.",
    namePlaceholder: "Key name (e.g. Claude Desktop)",
    emptyText: "No active keys. Create one to connect an AI client.",
  },
  rest: {
    title: "REST API Keys",
    description:
      "Keys for accessing the Sharetopus REST API. Use these with curl, scripts, or custom integrations.",
    namePlaceholder: "Key name (e.g. CI Pipeline)",
    emptyText: "No active REST API keys. Create one to start using the API.",
  },
};

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function labelForExpiryDays(days: ApiKeyExpiryDays): string {
  switch (days) {
    case 7:
      return "7 days (testing)";
    case 30:
      return "30 days";
    case 90:
      return "90 days (recommended)";
    case 365:
      return "1 year (advanced)";
  }
}

function expiryColorClass(expiresAtIso: string): string {
  const daysUntilExpiry = (new Date(expiresAtIso).getTime() - Date.now()) / MILLISECONDS_PER_DAY;
  if (daysUntilExpiry < 7) return "text-destructive";
  if (daysUntilExpiry < 30) return "text-yellow-600 dark:text-yellow-400";
  return "text-emerald-600 dark:text-emerald-400";
}

function expiryLabel(expiresAtIso: string): string {
  const expiresAt = new Date(expiresAtIso);
  if (expiresAt < new Date()) return "Expired";
  return `Expires ${expiresAt.toLocaleDateString()}`;
}

/** Lists, creates (raw key shown once) and revokes the user's MCP or REST API keys. */
export function ApiKeysCard({
  kind,
  initialKeys,
}: {
  kind: CardKeyKind;
  initialKeys: ApiKey[];
}) {
  const { userId } = useAuth();
  const copy = CARD_COPY[kind];
  const [keys, setKeys] = useState<ApiKey[]>(initialKeys);
  const [newKeyName, setNewKeyName] = useState("");
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null);
  const [selectedExpiresInDays, setSelectedExpiresInDays] =
    useState<ApiKeyExpiryDays>(DEFAULT_API_KEY_EXPIRY_DAYS);

  async function handleCreate() {
    const keyName = newKeyName.trim();
    if (!keyName) {
      setError("Enter a name for the key.");
      return;
    }
    setLoading(true);
    setError(null);

    const result =
      kind === "mcp"
        ? await createApiKey(userId ?? null, keyName, selectedExpiresInDays)
        : await createRestApiKey({ name: keyName, expiresInDays: selectedExpiresInDays });
    setLoading(false);

    if (!result.success) {
      setError(result.message);
      return;
    }

    setNewRawKey(result.rawKey);
    setNewKeyName("");
    setKeys((previousKeys) => [
      {
        id: result.keyId,
        name: keyName,
        prefix: result.prefix,
        created_at: new Date().toISOString(),
        last_used_at: null,
        expires_at: result.expiresAtIso,
      },
      ...previousKeys,
    ]);
  }

  async function handleRevoke(keyId: string) {
    setRevokingKeyId(keyId);
    setError(null);
    const result =
      kind === "mcp"
        ? await revokeApiKey(userId ?? null, keyId)
        : await revokeRestApiKey(userId ?? null, keyId);
    setRevokingKeyId(null);
    if (result.success) {
      setKeys((previousKeys) => previousKeys.filter((apiKey) => apiKey.id !== keyId));
      toast.success("Key revoked");
    } else {
      setError(result.message);
    }
  }

  async function handleCopy() {
    if (newRawKey) {
      await navigator.clipboard.writeText(newRawKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={newKeyName}
            onChange={(event) => setNewKeyName(event.target.value)}
            placeholder={copy.namePlaceholder}
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
            maxLength={100}
          />
          <Button onClick={handleCreate} disabled={loading} size="sm">
            {loading ? "Creating..." : "Create Key"}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground whitespace-nowrap">
            Expires in:
          </label>
          <select
            value={selectedExpiresInDays}
            onChange={(event) => {
              const days = Number(event.target.value);
              if (isValidApiKeyExpiryDays(days)) setSelectedExpiresInDays(days);
            }}
            className="rounded-md border bg-background px-3 py-2 text-sm"
            aria-label="Key expiry duration"
          >
            {API_KEY_EXPIRY_DAYS_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {labelForExpiryDays(days)}
              </option>
            ))}
          </select>
        </div>

        {selectedExpiresInDays === 365 && (
          <p className="text-xs text-destructive">
            Long-lived keys (1 year) are a security risk. Consider 90 days
            unless you have a specific reason to extend.
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {newRawKey && (
          <div className="rounded-md border border-yellow-500/30 bg-yellow-50 p-3 dark:bg-yellow-900/20">
            <p className="mb-2 text-sm font-medium text-yellow-800 dark:text-yellow-200">
              Copy this key now. It will not be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-yellow-100 px-2 py-1 text-xs dark:bg-yellow-900/40">
                {newRawKey}
              </code>
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setNewRawKey(null)}
            >
              Dismiss
            </Button>
          </div>
        )}

        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.emptyText}</p>
        ) : (
          <div className="space-y-2">
            {keys.map((apiKey) => (
              <div
                key={apiKey.id}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{apiKey.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <code>{apiKey.prefix}...</code>
                    {" | "}
                    Created {new Date(apiKey.created_at).toLocaleDateString()}
                    {apiKey.last_used_at && (
                      <>
                        {" | "}
                        Last used {new Date(apiKey.last_used_at).toLocaleDateString()}
                      </>
                    )}
                    {apiKey.expires_at && (
                      <>
                        {" | "}
                        <span className={expiryColorClass(apiKey.expires_at)}>
                          {expiryLabel(apiKey.expires_at)}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={revokingKeyId === apiKey.id}
                    >
                      {revokingKeyId === apiKey.id ? "Revoking..." : "Revoke"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Revoke &quot;{apiKey.name}&quot;?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Any client using this key loses access right away. This
                        cannot be undone; create a new key to reconnect.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep key</AlertDialogCancel>
                      <AlertDialogAction
                        className={buttonVariants({ variant: "destructive" })}
                        onClick={() => handleRevoke(apiKey.id)}
                      >
                        Revoke key
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
