"use client";

import { Button } from "@/components/ui/button";
import type {
  WebhookDeliveryDTO,
  WebhookSubscriptionDTO,
} from "@/lib/api/rest/openapi/responseSchemas";
import { DeliveryLog, fetchRecentDeliveriesOrEmpty } from "./DeliveryLog";
import { Suspense, useState } from "react";

type OpenDeliveryLog = {
  subscriptionId: string;
  deliveriesPromise: Promise<WebhookDeliveryDTO[]>;
};

/** Webhook subscriptions, each with an expandable delivery log. */
export function WebhookList({
  subscriptions,
  onDelete,
  onToggle,
  onTest,
}: {
  subscriptions: WebhookSubscriptionDTO[];
  onDelete: (id: string) => void;
  onToggle: (id: string, active: boolean) => void;
  onTest: (id: string) => void;
}) {
  const [openDeliveryLog, setOpenDeliveryLog] =
    useState<OpenDeliveryLog | null>(null);

  const toggleDeliveryLog = (subscriptionId: string) => {
    if (openDeliveryLog?.subscriptionId === subscriptionId) {
      setOpenDeliveryLog(null);
      return;
    }
    setOpenDeliveryLog({
      subscriptionId,
      deliveriesPromise: fetchRecentDeliveriesOrEmpty(subscriptionId),
    });
  };

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
                onClick={() => toggleDeliveryLog(subscription.id)}
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
          {openDeliveryLog?.subscriptionId === subscription.id && (
            <div className="mt-4 border-t border-border pt-4">
              <Suspense
                fallback={
                  <p className="text-xs text-muted-foreground">
                    Loading deliveries...
                  </p>
                }
              >
                <DeliveryLog
                  deliveriesPromise={openDeliveryLog.deliveriesPromise}
                />
              </Suspense>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
