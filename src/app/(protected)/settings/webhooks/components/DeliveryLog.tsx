"use client";

import { useEffect, useState } from "react";

type Delivery = {
  id: string;
  event_type: string;
  status_code: number | null;
  attempt: number;
  latency_ms: number | null;
  delivered_at: string | null;
  failed_at: string | null;
  error_message: string | null;
  created_at: string;
};

/**
 * Expandable delivery log for a webhook subscription.
 * Fetches on mount and shows status badges.
 */
export function DeliveryLog({
  subscriptionId,
}: {
  subscriptionId: string;
}) {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchDeliveries() {
      try {
        const response = await fetch(
          `/api/v1/webhooks/${subscriptionId}/deliveries?limit=20`,
          { credentials: "include" },
        );
        if (!response.ok) return;
        const result = await response.json();
        setDeliveries(result.data ?? []);
      } finally {
        setIsLoading(false);
      }
    }
    fetchDeliveries();
  }, [subscriptionId]);

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Loading deliveries...</p>;
  }

  if (deliveries.length === 0) {
    return <p className="text-xs text-muted-foreground">No deliveries yet.</p>;
  }

  return (
    <div className="space-y-2">
      {deliveries.map((delivery) => {
        const isSuccess =
          delivery.status_code !== null &&
          delivery.status_code >= 200 &&
          delivery.status_code < 300;
        const isFailed = delivery.failed_at !== null;

        return (
          <div
            key={delivery.id}
            className="flex items-center gap-3 text-xs py-1"
          >
            <span
              className={`inline-block h-2 w-2 rounded-full shrink-0 ${
                isSuccess
                  ? "bg-green-500"
                  : isFailed
                    ? "bg-red-500"
                    : "bg-gray-400"
              }`}
            />
            <span className="font-mono text-muted-foreground w-12">
              {delivery.status_code ?? "---"}
            </span>
            <span className="truncate flex-1">{delivery.event_type}</span>
            <span className="text-muted-foreground shrink-0">
              {delivery.latency_ms !== null ? `${delivery.latency_ms}ms` : ""}
            </span>
            <span className="text-muted-foreground shrink-0">
              {new Date(delivery.created_at).toLocaleString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}
