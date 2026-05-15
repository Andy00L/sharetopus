"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { WebhookList } from "./components/WebhookList";
import { WebhookForm } from "./components/WebhookForm";
import { Button } from "@/components/ui/button";

type WebhookSubscription = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  failure_count: number;
  last_delivery_at: string | null;
  last_disabled_at: string | null;
  created_at: string;
  updated_at: string;
  secret?: string;
};

/**
 * Client component orchestrating the webhooks management UI.
 * Fetches data via internal API calls (same-origin).
 */
export function WebhooksClient() {
  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newlyCreatedSecret, setNewlyCreatedSecret] = useState<string | null>(null);

  const fetchSubscriptions = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/webhooks", { credentials: "include" });
      if (!response.ok) return;
      const result = await response.json();
      setSubscriptions(result.data ?? []);
    } catch {
      toast.error("Failed to load webhooks");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSubscriptions();
  }, [fetchSubscriptions]);

  const handleCreate = async (url: string, events: string[]) => {
    try {
      const response = await fetch("/api/v1/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ url, events }),
      });
      const result = await response.json();
      if (!response.ok) {
        toast.error(result.error?.message ?? "Failed to create webhook");
        return;
      }
      setNewlyCreatedSecret(result.secret ?? null);
      setShowCreateForm(false);
      toast.success("Webhook created");
      fetchSubscriptions();
    } catch {
      toast.error("Failed to create webhook");
    }
  };

  const handleDelete = async (subscriptionId: string) => {
    try {
      const response = await fetch(`/api/v1/webhooks/${subscriptionId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        toast.error("Failed to delete webhook");
        return;
      }
      toast.success("Webhook deleted");
      fetchSubscriptions();
    } catch {
      toast.error("Failed to delete webhook");
    }
  };

  const handleToggle = async (subscriptionId: string, active: boolean) => {
    try {
      const response = await fetch(`/api/v1/webhooks/${subscriptionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ active }),
      });
      if (!response.ok) {
        toast.error("Failed to update webhook");
        return;
      }
      fetchSubscriptions();
    } catch {
      toast.error("Failed to update webhook");
    }
  };

  const handleTest = async (subscriptionId: string) => {
    try {
      const response = await fetch(`/api/v1/webhooks/${subscriptionId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: "{}",
      });
      const result = await response.json();
      if (result.status_code && result.status_code >= 200 && result.status_code < 300) {
        toast.success(`Test delivered (${result.status_code}, ${result.latency_ms}ms)`);
      } else {
        toast.error(`Test failed: ${result.error_message ?? `status ${result.status_code}`}`);
      }
    } catch {
      toast.error("Test request failed");
    }
  };

  if (isLoading) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {newlyCreatedSecret && (
        <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800 p-4">
          <p className="text-sm font-medium mb-2">
            Webhook secret (copy now, shown only once):
          </p>
          <code className="block text-xs bg-background rounded px-3 py-2 font-mono break-all select-all">
            {newlyCreatedSecret}
          </code>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => setNewlyCreatedSecret(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {showCreateForm ? (
        <WebhookForm
          onSubmit={handleCreate}
          onCancel={() => setShowCreateForm(false)}
        />
      ) : (
        <Button onClick={() => setShowCreateForm(true)}>
          Create webhook
        </Button>
      )}

      <WebhookList
        subscriptions={subscriptions}
        onDelete={handleDelete}
        onToggle={handleToggle}
        onTest={handleTest}
      />
    </div>
  );
}
