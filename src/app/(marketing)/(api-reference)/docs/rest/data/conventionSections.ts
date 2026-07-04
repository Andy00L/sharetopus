import type { DocsSection } from "@/lib/docs/apiReferenceTypes";

/**
 * Cross-cutting sections of the /docs/rest reference: authentication,
 * pagination, the error envelope, and rate limiting. Every literal was
 * extracted from the REST source, never from memory; each section
 * carries a sourceRef naming the files it was verified against.
 */

const QUICKSTART_CURL = `# Every request carries the API key as a Bearer token
curl "https://sharetopus.com/api/v1/posts" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY"`;

const UNAUTHORIZED_401 = `{
  "error": {
    "code": "unauthorized",
    "message": "Invalid or expired API key"
  },
  "request_id": "8f0a3c52-7c1e-4b8e-9f21-d4a0c0b6e7aa"
}`;

const PAGINATED_PAGE_2 = `# First page
curl "https://sharetopus.com/api/v1/posts?limit=20" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY"

# Next page: pass next_cursor from the previous response
curl "https://sharetopus.com/api/v1/posts?limit=20&cursor=2026-07-01T09:30:00.000Z" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY"`;

const PAGINATED_ENVELOPE = `{
  "data": [ { "...": "resource objects, newest first" } ],
  "next_cursor": "2026-07-01T09:30:00.000Z"
}`;

const RATE_LIMITED_429 = `{
  "error": {
    "code": "rate_limited",
    "message": "Too many requests",
    "details": { "retry_after_seconds": 42 }
  },
  "request_id": "8f0a3c52-7c1e-4b8e-9f21-d4a0c0b6e7aa"
}`;

export const REST_CONVENTION_SECTIONS: DocsSection[] = [
  {
    id: "authentication",
    navLabel: "Authentication",
    title: "Authentication",
    summary:
      "Every endpoint requires a Bearer API key. Keys are scoped to your account and require an active subscription.",
    sourceRef:
      "src/lib/api/rest/auth/resolveRestApiKey.ts, src/lib/api/rest/middleware/withRestEndpoint.ts",
    flowSteps: [
      {
        title: "Create a key.",
        body: "In the web app, open /integrations and click Create REST API Key. The key starts with stp_rest_ and is shown once; store it like a password.",
      },
      {
        title: "Send it on every request.",
        body: "Authorization: Bearer stp_rest_... . Keys are validated against a SHA-256 hash, checked for expiry, and require an active subscription.",
      },
      {
        title: "Handle 401 as terminal.",
        body: "A 401 unauthorized means the key is missing, malformed, expired, or the subscription lapsed. Rotating the key or fixing billing are the only remedies; retrying does not help.",
      },
    ],
    flowCodeSamples: [
      // featured: this page's single signature stamp card
      // (placement rule in docs/UI_DESIGN_SYSTEM.md).
      { label: "Quickstart · cURL", code: QUICKSTART_CURL, featured: true },
      { label: "Response · 401", code: UNAUTHORIZED_401 },
    ],
    callouts: [
      {
        tone: "blue",
        text: "Every response carries an x-request-id header (echoed as request_id in error bodies). Include it when contacting support.",
      },
    ],
  },
  {
    id: "pagination",
    navLabel: "Pagination",
    title: "Pagination",
    summary:
      "List endpoints use cursor pagination on the resource creation date, newest first. The cursor is opaque: always pass back next_cursor exactly as received.",
    sourceRef:
      "src/lib/api/rest/validation/schemas.ts (PostListQuerySchema), src/app/api/v1/posts/route.ts (GET)",
    flowSteps: [
      {
        title: "Request a page.",
        body: "limit accepts 1 to 100 and defaults to 20 on every list endpoint.",
      },
      {
        title: "Follow next_cursor.",
        body: "The response envelope is { data, next_cursor }. A null next_cursor means the last page. Pass the value back as ?cursor= to fetch the next page.",
      },
    ],
    flowCodeSamples: [
      { label: "Example · Two pages", code: PAGINATED_PAGE_2 },
      { label: "Response · Envelope", code: PAGINATED_ENVELOPE },
    ],
  },
  {
    id: "errors",
    navLabel: "Errors",
    title: "Error codes",
    summary:
      "Every error response uses one envelope: { error: { code, message, details? }, request_id }. details appears only on validation errors and rate limits.",
    sourceRef: "src/lib/api/rest/errors/restErrorResponse.ts",
    table: {
      columns: ["Status", "Code", "Meaning"],
      rows: [
        [
          "400",
          "validation_error",
          "The body or query failed schema validation, or the JSON is malformed. details carries the field-level issues.",
        ],
        [
          "401",
          "unauthorized",
          "Missing, malformed, or expired API key, or no active subscription.",
        ],
        [
          "403",
          "forbidden",
          "Key lacks the required scope, quota exhausted, or file access denied.",
        ],
        [
          "404",
          "not_found",
          "The resource does not exist or is not owned by your account. Unowned resources return 404, never 403.",
        ],
        ["429", "rate_limited", "Per-key rate limit exceeded. See Rate limits."],
        [
          "500",
          "internal_error",
          "Server-side failure. Retry with backoff; include request_id when reporting.",
        ],
      ],
    },
  },
  {
    id: "rate-limits",
    navLabel: "Rate limits",
    title: "Rate limits",
    summary:
      "Limits are enforced per API key and per action (for example rest.posts.create). A 429 carries retry_after_seconds in the error details when the window is known.",
    sourceRef:
      "src/lib/api/rest/middleware/withRestEndpoint.ts (checkRateLimit call)",
    codeSamples: [{ label: "Response · 429", code: RATE_LIMITED_429 }],
  },
];
