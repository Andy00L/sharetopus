"use client";

import { Button } from "@/components/ui/button";
import { DeliveryLog } from "./DeliveryLog";
import { useState } from "react";

type WebhookSubscription = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  failure_count: number;
  last_delivery_at: string | null;
  last_disabled_at: string | null;
  created_at: string;
};

/**
 * Renders the list of webhook subscriptions with expand/collapse
 * for delivery logs.
 */
export function WebhookList({
  subscriptions,
  onDelete,
  onToggle,
  onTest,
}: {
  subscriptions: WebhookSubscription[];
  onDelete: (id: string) => void;
  onToggle: (id: string, active: boolean) => void;
  onTest: (id: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (subscriptions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No webhook subscriptions yet. Create one to get started.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {subscriptions.map((subscription) => (
        <div
          key={subscription.id}
          className="rounded-lg border border-border p-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    subscription.active ? "bg-green-500" : "bg-gray-400"
                  }`}
                />
                <code className="text-sm font-mono truncate block">
                  {subscription.url}
                </code>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {subscription.events.map((eventName) => (
                  <span
                    key={eventName}
                    className="inline-block rounded bg-muted px-2 py-0.5 text-xs"
                  >
                    {eventName}
                  </span>
                ))}
              </div>
              {subscription.failure_count > 0 && (
                <p className="text-xs text-destructive mt-1">
                  {subscription.failure_count} consecutive failure(s)
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onTest(subscription.id)}
              >
                Test
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  onToggle(subscription.id, !subscription.active)
                }
              >
                {subscription.active ? "Disable" : "Enable"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setExpandedId(
                    expandedId === subscription.id
                      ? null
                      : subscription.id,
                  )
                }
              >
                Deliveries
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => onDelete(subscription.id)}
              >
                Delete
              </Button>
            </div>
          </div>
          {expandedId === subscription.id && (
            <div className="mt-4 border-t border-border pt-4">
              <DeliveryLog subscriptionId={subscription.id} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
