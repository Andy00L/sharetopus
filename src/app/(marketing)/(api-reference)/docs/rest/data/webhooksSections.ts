import type {
  DocsSection,
  ParamTableData,
} from "@/lib/docs/apiReferenceTypes";

/**
 * Webhooks resource of the /docs/rest reference. Field lists mirror
 * src/lib/api/rest/validation/webhookSchemas.ts (read in full); event
 * types mirror src/lib/api/rest/webhooks/eventTypes.ts; delivery and
 * signature details mirror the dispatch and signing modules.
 */

const SUBSCRIPTION_DTO_FIELDS: ParamTableData = {
  heading: "Response Fields (WebhookSubscriptionDTO)",
  rows: [
    {
      name: "id",
      type: "string (uuid)",
      required: true,
      description: "Subscription id.",
    },
    {
      name: "url",
      type: "string",
      required: true,
      description: "Destination HTTPS endpoint.",
    },
    {
      name: "events",
      type: "string[]",
      required: true,
      description: "Subscribed event types.",
    },
    {
      name: "active",
      type: "boolean",
      required: true,
      description:
        "False after repeated delivery failures disable the subscription.",
    },
    {
      name: "failure_count",
      type: "number",
      required: true,
      description: "Consecutive failed deliveries.",
    },
    {
      name: "last_delivery_at",
      type: "string | null",
      required: true,
      description: "Last delivery attempt.",
    },
    {
      name: "last_disabled_at",
      type: "string | null",
      required: true,
      description: "When the subscription was auto-disabled, if ever.",
    },
    {
      name: "created_at",
      type: "string",
      required: true,
      description: "Creation time.",
    },
    {
      name: "updated_at",
      type: "string",
      required: true,
      description: "Last update time.",
    },
  ],
};

const SIGNATURE_HEADERS = `Content-Type: application/json
X-Sharetopus-Event: post.published
X-Sharetopus-Delivery: 7d6c5b4a-3e2f-4d1c-8b9a-0f1e2d3c4b5a
X-Sharetopus-Signature: sha256=<hex(HMAC-SHA256(secret, raw_body))>
User-Agent: Sharetopus-Webhook/1.0`;

const EVENT_PAYLOAD = `{
  "event_type": "post.published",
  "event_id": "b2a1c0d9-8e7f-4a6b-5c4d-3e2f1a0b9c8d",
  "delivery_id": "7d6c5b4a-3e2f-4d1c-8b9a-0f1e2d3c4b5a",
  "created_at": "2026-07-04T18:02:11.000Z",
  "data": { "...": "event-specific fields" }
}`;

export const REST_WEBHOOKS_SECTION: DocsSection = {
  id: "webhooks",
  navLabel: "Webhooks",
  title: "Webhooks",
  summary:
    "HTTPS event notifications instead of polling. Each delivery is HMAC-SHA256 signed with the subscription secret, which is returned exactly once at creation.",
  sourceRef:
    "src/app/api/v1/webhooks/**/route.ts, src/lib/api/rest/validation/webhookSchemas.ts, src/lib/api/rest/webhooks/eventTypes.ts, signWebhookPayload.ts",
  table: {
    columns: ["Event", "Fires when"],
    rows: [
      ["post.scheduled", "A post is successfully scheduled."],
      ["post.published", "A post is published to a social platform."],
      ["post.failed", "Publishing a post fails."],
      ["connection.connected", "An OAuth flow completes and the account is connected."],
      [
        "connection.expired",
        "An account token expires and cannot be refreshed.",
      ],
    ],
  },
  tableNote:
    "Verify every delivery: compute HMAC-SHA256 of the raw request body with your subscription secret and compare it to the X-Sharetopus-Signature header (sha256=<hex> format).",
  codeSamples: [
    { label: "Delivery · Headers", code: SIGNATURE_HEADERS },
    { label: "Delivery · Payload", code: EVENT_PAYLOAD },
  ],
  operations: [
    {
      id: "webhooks-create",
      method: "POST",
      path: "/api/v1/webhooks",
      title: "Create a subscription",
      description:
        "Subscribes an HTTPS endpoint to 1 to 20 event types. The response is the subscription plus the signing secret; the secret is never returned again.",
      sourceRef:
        "src/app/api/v1/webhooks/route.ts (POST), webhookSchemas.ts (WebhookCreateInputSchema)",
      paramTables: [
        {
          heading: "Request Body",
          rows: [
            {
              name: "url",
              type: "string (url)",
              required: true,
              description:
                "HTTPS endpoint, max 2048 characters. Private addresses are rejected.",
            },
            {
              name: "events",
              type: "string[]",
              required: true,
              description: "1 to 20 event types from the table above.",
            },
          ],
        },
        SUBSCRIPTION_DTO_FIELDS,
      ],
      callouts: [
        {
          tone: "amber",
          text: "The secret field appears only in this response. Store it immediately; recovering it later requires creating a new subscription.",
        },
      ],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl -X POST "https://sharetopus.com/api/v1/webhooks" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "url": "https://example.com/hooks/sharetopus", "events": ["post.published", "post.failed"] }'`,
        },
      ],
    },
    {
      id: "webhooks-list",
      method: "GET",
      path: "/api/v1/webhooks",
      title: "List subscriptions",
      description:
        "All subscriptions for the account, newest first. Not paginated.",
      sourceRef: "src/app/api/v1/webhooks/route.ts (GET)",
      paramTables: [],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl "https://sharetopus.com/api/v1/webhooks" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY"`,
        },
      ],
    },
    {
      id: "webhooks-get",
      method: "GET",
      path: "/api/v1/webhooks/{id}",
      title: "Get a subscription",
      description: "One subscription by id, without the secret.",
      sourceRef: "src/app/api/v1/webhooks/[id]/route.ts (GET)",
      paramTables: [],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl "https://sharetopus.com/api/v1/webhooks/9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY"`,
        },
      ],
    },
    {
      id: "webhooks-patch",
      method: "PATCH",
      path: "/api/v1/webhooks/{id}",
      title: "Update a subscription",
      description:
        "Changes the URL, the event list, or the active flag. At least one field is required. Setting active true resets failure_count and clears last_disabled_at, re-enabling a subscription that repeated failures disabled.",
      sourceRef:
        "src/app/api/v1/webhooks/[id]/route.ts (PATCH), webhookSchemas.ts (WebhookPatchInputSchema)",
      paramTables: [
        {
          heading: "Request Body",
          rows: [
            {
              name: "url",
              type: "string (url)",
              required: false,
              description: "New HTTPS endpoint, max 2048 characters.",
            },
            {
              name: "events",
              type: "string[]",
              required: false,
              description: "Replacement event list, 1 to 20 types.",
            },
            {
              name: "active",
              type: "boolean",
              required: false,
              description: "true re-enables a disabled subscription.",
            },
          ],
        },
      ],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl -X PATCH "https://sharetopus.com/api/v1/webhooks/9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "active": true }'`,
        },
      ],
    },
    {
      id: "webhooks-delete",
      method: "DELETE",
      path: "/api/v1/webhooks/{id}",
      title: "Delete a subscription",
      description:
        "Deletes the subscription and its delivery history. Not reversible.",
      sourceRef: "src/app/api/v1/webhooks/[id]/route.ts (DELETE)",
      paramTables: [
        {
          heading: "Response Fields",
          rows: [
            {
              name: "id",
              type: "string (uuid)",
              required: true,
              description: "The deleted subscription.",
            },
            {
              name: "deleted",
              type: "boolean",
              required: true,
              description: "Always true on success.",
            },
          ],
        },
      ],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl -X DELETE "https://sharetopus.com/api/v1/webhooks/9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY"`,
        },
      ],
    },
    {
      id: "webhooks-test",
      method: "POST",
      path: "/api/v1/webhooks/{id}/test",
      title: "Send a test event",
      description:
        "Delivers a synthetic event synchronously (10 second timeout) and returns the actual delivery result, so you can debug the receiving endpoint without waiting for real traffic.",
      sourceRef:
        "src/app/api/v1/webhooks/[id]/test/route.ts, webhookSchemas.ts (WebhookTestInputSchema)",
      paramTables: [
        {
          heading: "Request Body",
          rows: [
            {
              name: "event_type",
              type: "string",
              required: false,
              description:
                "Event type to simulate. Defaults to a webhook.test payload.",
            },
          ],
        },
        {
          heading: "Response Fields",
          rows: [
            {
              name: "delivery_id",
              type: "string (uuid)",
              required: true,
              description: "Recorded delivery.",
            },
            {
              name: "subscription_id",
              type: "string (uuid)",
              required: true,
              description: "The subscription tested.",
            },
            {
              name: "status_code",
              type: "number | null",
              required: true,
              description: "HTTP status your endpoint returned.",
            },
            {
              name: "latency_ms",
              type: "number",
              required: true,
              description: "Round-trip latency.",
            },
            {
              name: "delivered_at",
              type: "string | null",
              required: true,
              description: "Set when the delivery succeeded.",
            },
            {
              name: "error_message",
              type: "string | null",
              required: true,
              description: "Set when the delivery failed.",
            },
          ],
        },
      ],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl -X POST "https://sharetopus.com/api/v1/webhooks/9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d/test" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "event_type": "post.published" }'`,
        },
      ],
    },
    {
      id: "webhooks-deliveries",
      method: "GET",
      path: "/api/v1/webhooks/{id}/deliveries",
      title: "List deliveries",
      description:
        "Cursor-paginated delivery log for one subscription: status codes, latency, attempts, and errors.",
      sourceRef:
        "src/app/api/v1/webhooks/[id]/deliveries/route.ts, webhookSchemas.ts (WebhookDeliveryListQuerySchema)",
      paramTables: [
        {
          heading: "Query Parameters",
          rows: [
            {
              name: "limit",
              type: "number",
              required: false,
              description: "1 to 100. Default 20.",
            },
            {
              name: "cursor",
              type: "string",
              required: false,
              description: "next_cursor from the previous page.",
            },
          ],
        },
        {
          heading: "Response Fields (data[])",
          rows: [
            {
              name: "id",
              type: "string (uuid)",
              required: true,
              description: "Delivery id.",
            },
            {
              name: "event_type",
              type: "string",
              required: true,
              description: "Delivered event type.",
            },
            {
              name: "event_id",
              type: "string",
              required: true,
              description: "Event the delivery belongs to.",
            },
            {
              name: "status_code",
              type: "number | null",
              required: true,
              description: "HTTP status returned by the endpoint.",
            },
            {
              name: "attempt",
              type: "number",
              required: true,
              description: "Attempt counter for the event.",
            },
            {
              name: "latency_ms",
              type: "number | null",
              required: true,
              description: "Round-trip latency.",
            },
            {
              name: "delivered_at",
              type: "string | null",
              required: true,
              description: "Set on success.",
            },
            {
              name: "failed_at",
              type: "string | null",
              required: true,
              description: "Set on failure.",
            },
            {
              name: "error_message",
              type: "string | null",
              required: true,
              description: "Failure detail.",
            },
            {
              name: "created_at",
              type: "string",
              required: true,
              description: "Record creation time.",
            },
          ],
        },
      ],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl "https://sharetopus.com/api/v1/webhooks/9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d/deliveries?limit=20" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY"`,
        },
      ],
    },
    {
      id: "webhooks-replay",
      method: "POST",
      path: "/api/v1/webhooks/{id}/deliveries/{delivery_id}/replay",
      title: "Replay a delivery",
      description:
        "Re-dispatches a past event through the same delivery pipeline as live events. The subscription must be active; disabled subscriptions return 403.",
      sourceRef:
        "src/app/api/v1/webhooks/[id]/deliveries/[delivery_id]/replay/route.ts",
      paramTables: [
        {
          heading: "Response Fields",
          rows: [
            {
              name: "subscription_id",
              type: "string (uuid)",
              required: true,
              description: "The subscription targeted.",
            },
            {
              name: "original_delivery_id",
              type: "string (uuid)",
              required: true,
              description: "The delivery replayed.",
            },
            {
              name: "event_type",
              type: "string",
              required: true,
              description: "Event type re-dispatched.",
            },
            {
              name: "message",
              type: "string",
              required: true,
              description: "Confirmation; a new delivery appears shortly.",
            },
          ],
        },
      ],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl -X POST "https://sharetopus.com/api/v1/webhooks/9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d/deliveries/7d6c5b4a-3e2f-4d1c-8b9a-0f1e2d3c4b5a/replay" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY"`,
        },
      ],
    },
  ],
};
