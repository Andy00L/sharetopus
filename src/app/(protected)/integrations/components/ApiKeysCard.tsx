"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createApiKey } from "@/actions/server/mcp/createApiKey";
import { revokeApiKey } from "@/actions/server/mcp/revokeApiKey";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

/**
 * Card component for managing MCP API keys.
 *
 * Shows existing keys with their prefix and metadata.
 * Allows creating new keys (shows raw key once) and revoking existing ones.
 *
 * Called by: src/app/(protected)/integrations/page.tsx
 * Server actions used: createApiKey, revokeApiKey
 */
export function ApiKeysCard({ initialKeys }: { initialKeys: ApiKey[] }) {
  const { userId } = useAuth();
  const [keys, setKeys] = useState<ApiKey[]>(initialKeys);
  const [newKeyName, setNewKeyName] = useState("");
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCreate() {
    if (!newKeyName.trim()) {
      setError("Enter a name for the key.");
      return;
    }
    setLoading(true);
    setError(null);

    const result = await createApiKey(userId ?? null, newKeyName.trim());
    setLoading(false);

    if (!result.success) {
      setError(result.message);
      return;
    }

    setNewRawKey(result.rawKey ?? null);
    setNewKeyName("");
    // Optimistically add to list
    if (result.keyId) {
      setKeys((prev) => [
        {
          id: result.keyId!,
          name: newKeyName.trim(),
          prefix: result.rawKey?.slice(0, 16) ?? "stp_mcp_...",
          created_at: new Date().toISOString(),
          last_used_at: null,
          expires_at: null,
        },
        ...prev,
      ]);
    }
  }

  async function handleRevoke(keyId: string) {
    const confirmed = window.confirm(
      "Revoke this key? Any client using it will lose access immediately."
    );
    if (!confirmed) return;

    const result = await revokeApiKey(userId ?? null, keyId);
    if (result.success) {
      setKeys((prev) => prev.filter((k) => k.id !== keyId));
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
        <CardTitle>MCP API Keys</CardTitle>
        <CardDescription>
          Keys for connecting AI clients to Sharetopus via the Model Context Protocol.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* New key creation */}
        <div className="flex gap-2">
          <input
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Key name (e.g. Claude Desktop)"
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
            maxLength={100}
          />
          <Button onClick={handleCreate} disabled={loading} size="sm">
            {loading ? "Creating..." : "Create Key"}
          </Button>
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {/* Show raw key once */}
        {newRawKey && (
          <div className="rounded-md border border-yellow-500/30 bg-yellow-50 p-3 dark:bg-yellow-900/20">
            <p className="mb-2 text-sm font-medium text-yellow-800 dark:text-yellow-200">
              Copy this key now. It will not be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-yellow-100 px-2 py-1 text-xs dark:bg-yellow-900/40">
                {newRawKey}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
              >
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

        {/* Key list */}
        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active keys. Create one to connect an AI client.
          </p>
        ) : (
          <div className="space-y-2">
            {keys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{key.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <code>{key.prefix}...</code>
                    {" | "}
                    Created {new Date(key.created_at).toLocaleDateString()}
                    {key.last_used_at && (
                      <>
                        {" | "}
                        Last used {new Date(key.last_used_at).toLocaleDateString()}
                      </>
                    )}
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleRevoke(key.id)}
                >
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
