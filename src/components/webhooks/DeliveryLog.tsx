"use client";

import type { WebhookDeliveryDTO } from "@/lib/api/rest/openapi/responseSchemas";
import { use } from "react";

const RECENT_DELIVERIES_LIMIT = 20;

export async function fetchRecentDeliveriesOrEmpty(
  subscriptionId: string,
): Promise<WebhookDeliveryDTO[]> {
  try {
    const response = await fetch(
      `/api/v1/webhooks/${subscriptionId}/deliveries?limit=${RECENT_DELIVERIES_LIMIT}`,
      { credentials: "include" },
    );
    if (!response.ok) return [];
    const result = await response.json();
    return result.data ?? [];
  } catch (error) {
    console.error("[fetchRecentDeliveriesOrEmpty] Delivery log request failed:", error);
    return [];
  }
}

export function DeliveryLog({
  deliveriesPromise,
}: {
  deliveriesPromise: Promise<WebhookDeliveryDTO[]>;
}) {
  const deliveries = use(deliveriesPromise);

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
