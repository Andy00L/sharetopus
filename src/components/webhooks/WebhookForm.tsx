"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WEBHOOK_EVENT_TYPES } from "@/lib/api/rest/webhooks/eventTypes";
import { EventPicker } from "./EventPicker";

/** Create form for a webhook subscription: HTTPS URL plus event checkboxes. */
export function WebhookForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (url: string, events: string[]) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([
    ...WEBHOOK_EVENT_TYPES,
  ]);

  const isValid = url.startsWith("https://") && selectedEvents.length > 0;

  return (
    <div className="rounded-lg border border-border p-4 space-y-4">
      <div>
        <label className="text-sm font-medium block mb-1">
          Endpoint URL
        </label>
        <Input
          type="url"
          placeholder="https://your-server.com/webhook"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <p className="text-xs text-muted-foreground mt-1">
          Must be HTTPS. No localhost or private IPs.
        </p>
      </div>

      <EventPicker
        allEvents={WEBHOOK_EVENT_TYPES}
        selectedEvents={selectedEvents}
        onChange={setSelectedEvents}
      />

      <div className="flex gap-2">
        <Button onClick={() => onSubmit(url, selectedEvents)} disabled={!isValid}>
          Create
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
