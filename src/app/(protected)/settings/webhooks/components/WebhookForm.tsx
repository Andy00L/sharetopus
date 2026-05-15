"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EventPicker } from "./EventPicker";

const ALL_EVENTS = [
  "post.scheduled",
  "post.published",
  "post.failed",
  "connection.connected",
  "connection.expired",
];

/**
 * Form for creating a new webhook subscription.
 * URL input + event checkboxes.
 */
export function WebhookForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (url: string, events: string[]) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([
    ...ALL_EVENTS,
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
        allEvents={ALL_EVENTS}
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
