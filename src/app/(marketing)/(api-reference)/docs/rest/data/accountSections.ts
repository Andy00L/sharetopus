import type { DocsSection } from "@/lib/docs/apiReferenceTypes";

/**
 * Account-level read endpoints of the /docs/rest reference: analytics,
 * content history, and usage. Field lists mirror
 * src/lib/api/rest/validation/analyticsSchemas.ts (read in full) and the
 * DTO factories.
 */

export const REST_ACCOUNT_SECTION: DocsSection = {
  id: "account",
  navLabel: "Analytics and usage",
  title: "Analytics, history, and usage",
  summary:
    "Account-wide reads: performance metrics, the published-content log, and the current billing period's quotas and storage.",
  sourceRef:
    "src/app/api/v1/analytics/route.ts, content-history/route.ts, usage/route.ts, src/lib/api/rest/validation/analyticsSchemas.ts",
  operations: [
    {
      id: "analytics-list",
      method: "GET",
      path: "/api/v1/analytics",
      title: "List analytics",
      description:
        "Account-wide metric rows, cursor-paginated on metric date. Metrics are collected after publication and may lag the platform by up to a day.",
      sourceRef:
        "src/app/api/v1/analytics/route.ts, analyticsSchemas.ts (AnalyticsQuerySchema)",
      paramTables: [
        {
          heading: "Query Parameters",
          rows: [
            {
              name: "platform",
              type: "string",
              required: false,
              description:
                "linkedin, tiktok, pinterest, instagram, youtube, x, or facebook.",
            },
            {
              name: "content_id",
              type: "string",
              required: false,
              description: "Filter by platform-side content id.",
            },
            {
              name: "days",
              type: "number",
              required: false,
              description: "Lookback window, 1 to 90. Default 30.",
            },
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
              description: "Metric row id.",
            },
            {
              name: "platform",
              type: "string",
              required: true,
              description: "Platform the metric belongs to.",
            },
            {
              name: "content_id",
              type: "string | null",
              required: true,
              description: "Platform-side content id.",
            },
            {
              name: "metric_date",
              type: "string",
              required: true,
              description: "Day the metrics were sampled.",
            },
            {
              name: "views",
              type: "number",
              required: true,
              description: "Views at sample time.",
            },
            {
              name: "likes",
              type: "number",
              required: true,
              description: "Likes at sample time.",
            },
            {
              name: "comments",
              type: "number",
              required: true,
              description: "Comments at sample time.",
            },
            {
              name: "shares",
              type: "number",
              required: true,
              description: "Shares at sample time.",
            },
            {
              name: "subscribers",
              type: "number",
              required: true,
              description: "Account followers or subscribers at sample time.",
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
          code: `curl "https://sharetopus.com/api/v1/analytics?platform=tiktok&days=30" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY"`,
        },
      ],
    },
    {
      id: "content-history-list",
      method: "GET",
      path: "/api/v1/content-history",
      title: "List content history",
      description:
        "Published content records, cursor-paginated, newest first. This is the confirmation surface after immediate publishing.",
      sourceRef:
        "src/app/api/v1/content-history/route.ts, analyticsSchemas.ts (ContentHistoryQuerySchema)",
      paramTables: [
        {
          heading: "Query Parameters",
          rows: [
            {
              name: "platform",
              type: "string",
              required: false,
              description:
                "Any of linkedin, tiktok, pinterest, instagram, facebook, threads, youtube, x.",
            },
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
              description: "History record id.",
            },
            {
              name: "platform",
              type: "string",
              required: true,
              description: "Platform the content went to.",
            },
            {
              name: "content_id",
              type: "string",
              required: true,
              description: "Platform-side content identifier.",
            },
            {
              name: "scheduled_post_id",
              type: "string | null",
              required: true,
              description: "Originating post, when scheduled.",
            },
            {
              name: "title",
              type: "string | null",
              required: true,
              description: "Title, when set.",
            },
            {
              name: "description",
              type: "string | null",
              required: true,
              description: "Body text, when set.",
            },
            {
              name: "media_url",
              type: "string | null",
              required: true,
              description: "Public media URL, when available.",
            },
            {
              name: "media_type",
              type: "string | null",
              required: true,
              description: "text, image, or video.",
            },
            {
              name: "status",
              type: "string | null",
              required: true,
              description: "Platform-side publish status.",
            },
            {
              name: "batch_id",
              type: "string | null",
              required: true,
              description: "Batch the content came from.",
            },
            {
              name: "created_via",
              type: "string",
              required: true,
              description: "Surface that created the content (rest, mcp, x402, web).",
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
          code: `curl "https://sharetopus.com/api/v1/content-history?platform=x&limit=10" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY"`,
        },
      ],
    },
    {
      id: "usage-get",
      method: "GET",
      path: "/api/v1/usage",
      title: "Get usage",
      description:
        "Current plan, billing period, per-action usage counters, and storage consumption against the cap.",
      sourceRef: "src/app/api/v1/usage/route.ts",
      paramTables: [
        {
          heading: "Response Fields",
          rows: [
            {
              name: "plan",
              type: "string | null",
              required: true,
              description: "Active plan name.",
            },
            {
              name: "status",
              type: "string",
              required: true,
              description: "active, inactive, or past_due.",
            },
            {
              name: "current_period_end",
              type: "string | null",
              required: true,
              description: "End of the current billing period.",
            },
            {
              name: "period",
              type: "string",
              required: true,
              description: "Quota period type (month).",
            },
            {
              name: "actions",
              type: "object",
              required: true,
              description: "Per-action usage counters for the period.",
            },
            {
              name: "storage",
              type: "object",
              required: true,
              description:
                "used_bytes, cap_bytes, and human-readable equivalents.",
            },
          ],
        },
      ],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl "https://sharetopus.com/api/v1/usage" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY"`,
        },
        {
          label: "Response · 200",
          code: `{
  "plan": "creator",
  "status": "active",
  "current_period_end": "2026-07-28T00:00:00.000Z",
  "period": "month",
  "actions": { "rest.posts.create": 42, "rest.media.upload_url": 17 },
  "storage": {
    "used_bytes": 734003200,
    "cap_bytes": 5368709120,
    "used_human": "700 MB",
    "cap_human": "5 GB"
  }
}`,
        },
      ],
    },
  ],
};
