# MCP Server

Sharetopus exposes an MCP server that lets AI agents (Claude Desktop, Cursor, ChatGPT) schedule posts, manage content, and query analytics on behalf of authenticated subscribers.

Two transports, both stateless (mcp-handler 1.1.0 does not support persistent sessions):

- **Streamable HTTP:** `https://sharetopus.com/api/mcp/mcp`
- **SSE:** `https://sharetopus.com/api/mcp/sse`

Built with mcp-handler 1.1.0 and @modelcontextprotocol/sdk 1.29.0.

> **Plan requirement:** MCP access requires the Creator plan or higher. All 18 tools require Creator tier minimum. Starter and free users have no MCP access.

[Back to README](../README.md)

---

## Table of contents

- [Authentication](#authentication)
- [Connecting from AI clients](#connecting-from-ai-clients)
- [withMcpTool higher-order function](#withmcptool-higher-order-function)
- [Tool inventory](#tool-inventory)
- [Tool details](#tool-details)
- [Tool annotations](#tool-annotations)
- [Resources](#resources)
- [Prompts](#prompts)
- [Usage examples](#usage-examples)
- [MCP request lifecycle](#mcp-request-lifecycle)
- [Idempotency](#idempotency)
- [Audit and session tracking](#audit-and-session-tracking)
- [OAuth client management](#oauth-client-management)
- [Known limitations](#known-limitations)
- [Source files referenced](#source-files-referenced)

---

## Authentication

Two auth paths, both resolving to a `McpPrincipal` (kind: `apikey` or `oauth`) with a cached subscription tier.

```mermaid
sequenceDiagram
    participant Agent as AI Agent
    participant Route as /api/mcp/[transport]
    participant Auth as resolveMcpPrincipal
    participant Gate as applySubscriptionGate
    participant Trust as assertOAuthClientTrust

    Agent->>Route: POST with Bearer token
    Route->>Route: Per-IP rate limit (100 req / 60s)
    Route->>Route: Extract clientInfo (initialize only)

    alt Token starts with stp_mcp_
        Auth->>Auth: resolveApiKey()
        Auth->>Auth: SHA-256 hash token
        Auth->>Auth: Lookup token_hash in api_keys
        Auth->>Auth: Check: not revoked, not expired
        Auth->>Auth: Update last_used_at
        Auth->>Gate: applySubscriptionGate()
        Gate->>Gate: Reject free/starter tiers
        Gate-->>Route: McpPrincipal (kind=apikey)
    else Clerk OAuth token
        Auth->>Auth: verifyOAuthToken() via Clerk SDK
        Auth->>Gate: applySubscriptionGate()
        Gate->>Gate: Reject free/starter tiers
        Gate-->>Auth: McpPrincipal (kind=oauth)
        Auth->>Trust: assertOAuthClientTrust()
        Trust->>Trust: Check blocked/revoked status
        Trust-->>Route: McpPrincipal (kind=oauth)
    end

    Route->>Route: Stash principal + requestSessionId in authInfo.extra
    Route-->>Agent: Server capabilities
```

The subscription gate runs before the OAuth trust check. This means non-paying users never leave a row in `mcp_oauth_clients`.

### Route-level rate limit

Every request hits a per-IP rate limit before any token handling:

- **100 requests per 60 seconds** per IP (SHA-256 hashed, raw IP never stored)
- Fires before bearer token check, so token-probing attackers cannot bypass the limiter
- `MAX_INITIALIZE_BODY_BYTES`: 16 KB (bodies larger than this skip clientInfo extraction)

### Generating an API key

1. Open the Sharetopus web app. Navigate to Settings or Integrations.
2. Click "Create MCP API Key" and give it a name.
3. Copy the key (shown once, format: `stp_mcp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`).
4. Store it in your MCP client config as a Bearer token.

Limits: 10 active MCP keys per user. Keys can be revoked from the UI. Requires Creator plan or higher.

---

## Connecting from AI clients

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sharetopus": {
      "url": "https://sharetopus.com/api/mcp/mcp",
      "headers": {
        "Authorization": "Bearer stp_mcp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

### Cursor

Same configuration format. Place the URL and Authorization header in Cursor's MCP server settings.

### Generic OAuth (RFC 9728 auto-discovery)

For clients with OAuth discovery support, only the URL is needed:

```json
{
  "mcpServers": {
    "sharetopus": {
      "url": "https://sharetopus.com/api/mcp/mcp"
    }
  }
}
```

The server publishes an RFC 9728 OAuth Protected Resource metadata endpoint at `/.well-known/oauth-protected-resource` for automatic discovery.

---

## withMcpTool higher-order function

Every tool handler is wrapped by `withMcpTool`, a higher-order function that centralizes context extraction, entitlement gating, and audit logging. Tool authors write only business logic. The wrapper handles everything else.

**Execution steps:**

1. **Extract per-request context** (principal, sessionId, requestId, ipHash, userAgent, clientName, clientVersion, startedAt)
2. **Compute audit args** via `auditArgsBuilder` if provided, otherwise fall back to `rawArgsAsAuditPayload` (coerces empty objects to null)
3. **Run entitlement gate** (tier check via `ACTION_PLAN_GATE`, then monthly quota via `MONTHLY_CAPS`)
4. **On deny:** emit audit row with status `denied` or `quota_exceeded`, return error to agent
5. **On allow:** call the inner handler
6. **On success or handler-returned isError:** emit audit row. Handler may override the result status via `auditStatus` (e.g., `rate_limited`) and the args via `auditArgs`
7. **On thrown error:** emit an `error` audit row with the default audit args, then re-throw so the SDK surfaces a JSON-RPC error

### McpToolContext

The context object passed to every handler:

| Field | Type | Description |
|-------|------|-------------|
| `principal` | `McpPrincipal` | Authenticated user with kind, principalId, scopes, plan |
| `sessionId` | `string \| null` | SDK session ID (real for SSE, synthetic UUID for stateless) |
| `requestId` | `string \| null` | Per-request correlation ID for cross-layer log tracing |
| `ipHash` | `string \| null` | SHA-256 of client IP + salt |
| `userAgent` | `string \| null` | Truncated to 512 chars |
| `clientName` | `string \| null` | From initialize handshake only (null on tool calls) |
| `clientVersion` | `string \| null` | From initialize handshake only (null on tool calls) |
| `startedAt` | `number` | `Date.now()` at context build time, used for latency computation |

### McpHandlerResult

The return type from every handler:

| Field | Type | Description |
|-------|------|-------------|
| `content` | `Array<{ type: "text"; text: string }>` | MCP SDK content envelope |
| `isError` | `boolean?` | Signals an error response to the agent |
| `auditStatus` | `string?` | Override the audit log status (default: `ok` if no error, `error` if isError) |
| `auditArgs` | `Record \| null?` | Override the args stored in the audit log |

### Usage pattern

```typescript
server.registerTool(
  "schedule_post",
  { ...toolConfig },
  withMcpTool("schedule_post", async (ctx, args) => {
    // Business logic only. Entitlement, audit, context are handled.
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }),
);

// With custom audit args scrubbing for large payloads:
withMcpTool(
  "bulk_schedule",
  async (ctx, args) => { /* ... */ },
  { auditArgsBuilder: (args) => ({ count: args.posts.length }) },
);
```

---

## Tool inventory

18 tools, all requiring Creator+ minimum. Quota enforcement is atomic (Postgres RPC `atomic_increment_quota`). Write tools that create posts support idempotent retries via `idempotency_key` (see [Idempotency](#idempotency)). All tools carry [Connectors Directory annotations](#tool-annotations).

Monthly quota format below: Creator cap / Pro cap.

| Tool | Type | Monthly Quota | Rate Limit | Description |
|------|------|---------------|------------|-------------|
| `list_connections` | Read | - | - | List connected social accounts with platform and status |
| `list_pinterest_boards` | Read | - | - | List Pinterest boards for an account (paginated) |
| `list_scheduled_posts` | Read | - | - | List scheduled posts, optional filter by platform/status |
| `list_content_history` | Read | - | - | View posted content history, optional platform filter |
| `list_billing_summary` | Read | - | - | View subscription plan, status, and monthly usage counts |
| `request_account_reauth_link` | Read | - | - | Get re-auth URL for an account with expired token |
| `get_account_analytics` | Read | - | - | Fetch metrics (views, likes, comments, shares) |
| `generate_post_draft` | Read | 100 / unlimited | - | Generate draft via client LLM (zero API cost) |
| `schedule_post` | Write | 500 / unlimited | - | Schedule a post for future publishing |
| `post_now` | Write | 500 / unlimited | - | Publish immediately via Inngest event |
| `cancel_scheduled_posts` | Write | - | - | Cancel 1-50 scheduled posts |
| `resume_scheduled_posts` | Write | - | - | Resume cancelled posts (past dates rescheduled +1h) |
| `reschedule_posts` | Write | - | - | Change scheduled time for 1-50 posts |
| `delete_scheduled_posts` | Write | - | - | Permanently delete 1-50 posts + cleanup orphan media |
| `attach_media_from_url` | Write | 500 / unlimited | 10/60s | Download from URL, upload to storage. SSRF-guarded. |
| `request_upload_url` | Write | 500 / unlimited | 20/60s | Get signed upload URL for direct media upload |
| `bulk_schedule` | Write | 200 / unlimited | - | Schedule up to 30 posts at once with idempotency |
| `bulk_post_now` | Write | 500 / unlimited | - | Publish up to 30 posts immediately with idempotency |

---

## Tool details

### list_connections

List connected social accounts. Returns platform, display name, and availability status. Tokens are stripped from the response.

**Parameters:**
```
include_unavailable  boolean  optional  default: false
  Include accounts that are disconnected or have expired tokens
```

**Returns:** Array of social account objects (id, platform, display_name, username, avatar_url, is_available).

---

### list_pinterest_boards

List Pinterest boards for a connected account. Use this to get the `board_id` required by `schedule_post` and `post_now` when targeting Pinterest.

**Parameters:**
```
social_account_id  string (UUID)  required
  ID of the Pinterest social_accounts row
page_size          number (1-100)  optional  default: 25
  Number of boards per page
bookmark           string  optional
  Pagination cursor from a previous response
```

**Returns:** `{ success, boards: [{ id, name, description, privacy, pin_count }], bookmark }`. If the account token is expired, returns `{ success: false, expired: true, reauth_url }`.

---

### list_scheduled_posts

List scheduled posts with optional filters.

**Parameters:**
```
platform  "linkedin" | "tiktok" | "pinterest" | "instagram"  optional
  Filter by platform
status    "scheduled" | "processing" | "posted" | "failed" | "cancelled"  optional
  Filter by post status
limit     number (1-100)  optional  default: 20
  Max results to return
```

**Returns:** Array of scheduled post objects.

---

### list_content_history

View posted content history.

**Parameters:**
```
platform  "linkedin" | "tiktok" | "pinterest" | "instagram"  optional
  Filter by platform
limit     number (1-100)  optional  default: 20
  Max results to return
```

**Returns:** Array of content history objects with platform, content_id, media_url, status.

---

### list_billing_summary

View current subscription and usage quotas. No parameters.

**Returns:** Object with subscription details (plan, status, current_period_end) and monthly usage counts per action.

---

### request_account_reauth_link

Get a browser re-authentication URL for an account with an expired token.

**Parameters:**
```
social_account_id  string (UUID)  required
  ID of the social account to re-authenticate
```

**Returns:** Object with reauth_url and account metadata. The user must open the URL in a browser.

---

### get_account_analytics

Fetch performance metrics for posted content. Data may be up to 24 hours old.

**Parameters:**
```
platform    "linkedin" | "tiktok" | "pinterest" | "instagram"  optional
content_id  string  optional
  Filter by specific content ID
days        number (1-90)  optional  default: 30
  Number of days to look back
limit       number (1-100)  optional  default: 20
```

**Returns:** Array of analytics objects with views, likes, comments, shares.

---

### generate_post_draft

Generate a draft post using the client's LLM. The tool returns a structured prompt; the client's model generates the draft. Zero API cost to the Sharetopus account. Requires a client with MCP sampling/createMessage support.

**Parameters:**
```
platform            "linkedin" | "tiktok" | "pinterest" | "instagram"  required
topic               string  required
  Topic or theme for the post
tone                "professional" | "casual" | "humorous" | "educational" | "promotional"
                    optional  default: "professional"
max_length          number (50-3000)  optional  default: 500
additional_context  string  optional
  Extra instructions or brand guidelines
```

**Monthly quota:** Creator 100/mo, Pro unlimited.

**Returns:** Structured prompt object. Clients without MCP sampling support receive an error.

---

### schedule_post

Schedule a post for future publishing. For media posts, call `attach_media_from_url` or `request_upload_url` first to get a `media_storage_path`.

**Parameters:**
```
social_account_id    string (UUID)  required
  ID of the social account to post to
platform             "linkedin" | "tiktok" | "pinterest" | "instagram"  required
  Target platform
scheduled_at         string (ISO 8601)  required
  When to publish (must be in the future)
post_type            "text" | "image" | "video"  required
  Type of post
title                string  optional
  Post title (used by some platforms)
description          string | null  required
  Post body text / caption
media_storage_path   string  optional  default: ""
  Supabase Storage path. Required for image/video posts.
batch_id             string  optional  default: ""
  Optional batch ID to group related posts
pinterest_board_id   string  optional
  Required for Pinterest posts. Get via list_pinterest_boards.
pinterest_board_name string  optional
  Display name for content_history records
pinterest_link       string (URL, max 2048)  optional
  Destination URL for Pinterest pin
idempotency_key      string (1-200 chars)  optional
  Client-supplied key for safe retries. Same key + same principal
  returns the existing scheduleId instead of inserting a duplicate.
  DB-enforced via UNIQUE constraint on (principal_id, idempotency_key).
```

**Monthly quota:** Creator 500/mo, Pro unlimited.

**Returns:** `{ success, message, scheduleId }`. The post enters `scheduled` status and will be dispatched by the `scheduled-posts-tick` cron when its time arrives. If the idempotency_key already exists for this principal, returns the existing scheduleId with a message indicating it was already created.

**Failure modes:** quota exceeded (monthly cap), account not found, account not owned by principal, invalid scheduled_at, missing media for image/video post.

---

### post_now

Publish a post immediately. Dispatches an Inngest `post.now` event. The post is processed asynchronously; check `list_content_history` after 30-60 seconds to confirm.

**Parameters:**
```
social_account_id    string (UUID)  required
platform             "linkedin" | "tiktok" | "pinterest" | "instagram"  required
post_type            "text" | "image" | "video"  required
title                string  optional
description          string | null  required
media_storage_path   string  optional  default: ""
cover_timestamp      number (min: 1000)  optional
  For TikTok video: cover frame at this millisecond mark
pinterest_board_id   string  optional
  Required for Pinterest posts
pinterest_board_name string  optional
  Display name for content_history
pinterest_link       string (URL, max 2048)  optional
  Destination URL for Pinterest pin
idempotency_key      string (1-200 chars)  optional
  Client-supplied key for safe retries. Same key + same principal
  returns the existing event_id instead of dispatching a duplicate.
  DB-enforced via UNIQUE constraint on (principal_id, idempotency_key)
  on the pending_direct_posts table.
```

**Monthly quota:** Creator 500/mo, Pro unlimited.

**Returns:** `{ success, event_id, batch_id, message }`. Use the event_id to poll status. If the idempotency_key already exists, returns the existing event_id with a message indicating it was already dispatched.

**Failure modes:** same as schedule_post, plus caption validation per platform.

---

### cancel_scheduled_posts

Cancel one or more scheduled posts. Only posts with status `scheduled` can be cancelled.

**Parameters:**
```
post_ids  string[] (UUIDs, 1-50 items)  required
```

**Returns:** Array of per-post results with success/failure for each.

---

### resume_scheduled_posts

Resume cancelled posts. Posts with past scheduled_at are automatically rescheduled to 1 hour from now.

**Parameters:**
```
post_ids  string[] (UUIDs, 1-50 items)  required
```

**Returns:** Array of per-post results.

---

### reschedule_posts

Change the scheduled time for posts. Cancelled posts are automatically resumed.

**Parameters:**
```
post_ids            string[] (UUIDs, 1-50 items)  required
new_scheduled_time  string (ISO 8601)  required
  Must be in the future
```

**Returns:** Array of per-post results.

---

### delete_scheduled_posts

Permanently delete scheduled posts. Cannot be undone. Orphaned media files are cleaned up from Supabase Storage.

**Parameters:**
```
post_ids  string[] (UUIDs, 1-50 items)  required
```

**Returns:** Array of per-post results.

---

### attach_media_from_url

Download media from a public URL and upload it to Sharetopus storage. Returns a storage path for use with `schedule_post` or `post_now`. The download is SSRF-guarded via `safeUserFetch` (see [docs/SECURITY.md](./SECURITY.md#ssrf-guard)).

**Parameters:**
```
url       string (valid HTTP/HTTPS URL)  required
  Public URL of the media file
filename  string  optional
  Override filename (defaults to URL basename)
```

**Size limits:** 8 MB (image), 250 MB (video). Enforced by stream-based byte counter (Content-Length header is not trusted).

**Rate limit:** 10 requests per 60 seconds per principal.

**Monthly quota:** Creator 500/mo, Pro unlimited.

**Allowed MIME types:** image/jpeg, image/png, image/gif, image/webp, video/mp4, video/quicktime, video/webm.

**SSRF protections:** Blocks loopback, link-local, RFC 1918, CGNAT, IPv6 ULA, IPv4-mapped IPv6, multicast, reserved ranges. Rejects non-http(s) schemes and 3xx redirects. DNS resolution validated before connect.

**Returns:** `{ success, storage_path, content_type, size_bytes }`.

---

### request_upload_url

Get a signed upload URL for direct media upload. The URL is valid for 2 hours (7200 seconds).

**Parameters:**
```
filename      string (min 1 char)  required
  Filename with extension (e.g. photo.jpg, clip.mp4)
content_type  string (min 1 char)  required
  MIME type. Allowed: image/jpeg, image/png, video/mp4, video/mov, video/quicktime
size_bytes    number (positive integer)  required
  File size in bytes
```

**Rate limit:** 20 requests per 60 seconds (hard limit).

**Monthly quota:** Creator 500/mo, Pro unlimited.

**Returns:** `{ success, upload_url, storage_path, token, expires_in_seconds }`.

---

### bulk_schedule

Schedule up to 30 posts at once. Each post gets an `idempotency_key` of `${batchId}:${index}`, making retries safe.

**Parameters:**
```
posts  Array (1-30 items)  required
  Each item:
    social_account_id  string (UUID)
    platform           "linkedin" | "tiktok" | "pinterest" | "instagram"
    scheduled_at       string (ISO 8601)
    post_type          "text" | "image" | "video"
    title              string  optional
    description        string | null
    media_storage_path string  optional  default: ""

batch_id  string  optional
  Group all posts under this batch ID
```

**Monthly quota:** Creator 200/mo, Pro unlimited.

**Preflight checks:** entitlement verification, platform daily quota enforcement (next 24h), social account ownership (single bulk query).

**Returns:** `{ batch_id, total, succeeded, failed, results: [...] }`.

---

### bulk_post_now

Publish up to 30 posts immediately in one call. Each post dispatches a separate Inngest `post.now` event.

**Parameters:**
```
posts  Array (1-30 items)  required
  Each item:
    social_account_id   string (UUID)
    platform            "linkedin" | "tiktok" | "pinterest" | "instagram"
    post_type           "text" | "image" | "video"
    title               string  optional
    description         string | null
    media_storage_path  string  optional  default: ""
    cover_timestamp     number (min: 1000)  optional
    pinterest_board_id  string  optional
    pinterest_board_name string  optional
    pinterest_link      string (URL, max 2048)  optional

batch_id  string (1-200 chars)  optional
  When supplied, each post gets idempotency_key = "${batch_id}:${index}",
  making retries safe. Same pattern as bulk_schedule.
```

**Monthly quota:** Creator 500/mo, Pro unlimited.

**Preflight checks:** entitlement verification, social account ownership (single bulk query), caption length validation per platform, Pinterest board requirement.

**Returns:** `{ success, batch_id, dispatched, total, results: [{ index, platform, social_account_id, event_id }] }`.

---

## Tool annotations

All 18 tools carry MCP Connectors Directory annotations via `registerTool`. Read-only tools set `readOnlyHint: true`. Write tools set `destructiveHint` and `idempotentHint` as appropriate.

| Tool | readOnlyHint | destructiveHint | idempotentHint | openWorldHint |
|------|:---:|:---:|:---:|:---:|
| list_connections | true | - | - | false |
| list_pinterest_boards | true | - | - | true |
| list_scheduled_posts | true | - | - | false |
| list_content_history | true | - | - | false |
| list_billing_summary | true | - | - | false |
| request_account_reauth_link | true | - | - | true |
| get_account_analytics | true | - | - | true |
| generate_post_draft | true | - | - | false |
| schedule_post | false | true | false | true |
| post_now | false | true | false | true |
| bulk_schedule | false | true | false | true |
| bulk_post_now | false | true | false | true |
| cancel_scheduled_posts | false | true | true | false |
| resume_scheduled_posts | false | false | true | false |
| reschedule_posts | false | true | true | false |
| delete_scheduled_posts | false | true | true | false |
| attach_media_from_url | false | false | false | true |
| request_upload_url | false | false | false | false |

---

## Resources

3 read-only resources. Same entitlement checks as the corresponding tools. Return empty contents if the user's plan does not qualify.

| URI | MIME Type | Description |
|-----|-----------|-------------|
| `mcp://sharetopus/scheduled-posts` | application/json | Scheduled posts (limit 100) |
| `mcp://sharetopus/connections` | application/json | Connected social accounts (tokens stripped) |
| `mcp://sharetopus/content-history` | application/json | Published content history (limit 100) |

---

## Prompts

3 reusable message templates that guide agent workflows.

| Prompt | Parameters | Purpose |
|--------|-----------|---------|
| `plan_week_for_platform` | platform, theme | Plan 5-7 posts around a theme for a specific platform |
| `repurpose_post` | post_id, target_platforms (comma-separated) | Fetch a post and adapt it for multiple platforms |
| `audit_calendar` | (none) | Audit the next 14 days of scheduled posts for gaps and imbalances |

---

## Usage examples

### Example 1: Schedule a Pinterest post for tomorrow

User prompt to agent: "Schedule a Pinterest post for tomorrow at 10am with this image: https://example.com/photo.jpg"

Tool call sequence:
1. `list_connections` to find the Pinterest account ID
2. `attach_media_from_url(url: "https://example.com/photo.jpg")` to upload the image
3. `schedule_post(social_account_id: "...", platform: "pinterest", scheduled_at: "2026-05-15T10:00:00Z", post_type: "image", description: "...", media_storage_path: "user_xxxx/abc123.jpg")`

### Example 2: Check analytics for the past week

User prompt: "Show me how my posts performed last week"

Tool call sequence:
1. `get_account_analytics(days: 7)` to fetch metrics across all platforms

The response includes views, likes, comments, and shares per content item. Data may be up to 24 hours old.

### Example 3: Cancel all Friday posts and reschedule to Monday

User prompt: "Cancel all my posts scheduled for this Friday and move them to next Monday at 9am"

Tool call sequence:
1. `list_scheduled_posts(status: "scheduled")` to find all scheduled posts
2. Agent filters results to Friday posts client-side
3. `reschedule_posts(post_ids: ["id1", "id2", "id3"], new_scheduled_time: "2026-05-19T09:00:00Z")`

Note: `reschedule_posts` also resumes cancelled posts, so if some were already cancelled, they get resumed with the new time.

### Example 4: Plan a week of LinkedIn content

User prompt: "Help me plan a week of LinkedIn posts about developer productivity"

The agent can use the `plan_week_for_platform` prompt:
1. Agent invokes the prompt with `platform: "linkedin"`, `theme: "developer productivity"`
2. The prompt returns a structured message guiding the agent to create 5-7 posts
3. Agent generates drafts (optionally using `generate_post_draft`)
4. Agent calls `bulk_schedule` to schedule all posts at once

---

## MCP request lifecycle

```mermaid
sequenceDiagram
    participant A as Agent
    participant R as /api/mcp/[transport]
    participant Auth as resolveMcpPrincipal
    participant HOF as withMcpTool
    participant Ent as entitlementFor
    participant Tool as Tool handler
    participant DB as Supabase
    participant Audit as logToolCall

    A->>R: POST initialize {clientInfo}
    R->>R: Per-IP rate limit (100/60s)
    R->>R: Extract clientName + clientVersion from body
    R->>Auth: Resolve principal (API key or OAuth)
    Auth-->>R: McpPrincipal
    R->>R: Generate synthetic requestSessionId (UUID)
    R-->>A: Server capabilities

    A->>R: POST tools/call {name, arguments}
    R->>Auth: Resolve principal
    Auth-->>R: McpPrincipal
    R->>HOF: withMcpTool(toolName, handler)
    HOF->>HOF: buildContext (principal, session, ip, ua, client)
    HOF->>HOF: Compute defaultAuditArgs (auditArgsBuilder or rawArgsAsAuditPayload)
    HOF->>Ent: entitlementFor(principal, toolName)
    Ent->>Ent: checkTierGate (ACTION_PLAN_GATE)
    Ent->>Ent: checkAndIncrementQuota (atomic_increment_quota RPC)

    alt deny (no_subscription / plan_too_low / monthly_quota)
        Ent-->>HOF: deny
        HOF->>Audit: emitAudit(denied | quota_exceeded)
        HOF-->>A: Error with deny reason
    else allow
        Ent-->>HOF: allow
        HOF->>Tool: handler(ctx, args)
        Tool->>Tool: Rate limit check (if applicable)
        Tool->>Tool: Idempotency pre-check (if key provided)
        Tool->>DB: Query / mutate
        DB-->>Tool: Result
        Tool-->>HOF: McpHandlerResult
        HOF->>Audit: emitAudit(ok | error | rate_limited)
        HOF-->>A: JSON result
    end

    Note over Audit,DB: Audit INSERT awaited (compliance)
    Note over Audit,DB: Session UPSERT via waitUntil (background)
```

---

## Idempotency

Four tools support idempotent retries. Two accept an explicit `idempotency_key` parameter. Two derive the key automatically.

| Tool | Key source | DB constraint |
|------|-----------|---------------|
| `schedule_post` | `idempotency_key` param | UNIQUE on `(principal_id, idempotency_key)` in `scheduled_posts` |
| `post_now` | `idempotency_key` param | UNIQUE on `(principal_id, idempotency_key)` in `pending_direct_posts` |
| `bulk_schedule` | Derived: `${batchId}:${index}` | Same as `schedule_post` |
| `bulk_post_now` | Derived: `${batch_id}:${index}` | Same as `post_now` |

All four use `INSERT ... ON CONFLICT DO NOTHING`. If the insert conflicts, the handler fetches the existing row and returns its ID with a message like "already dispatched". Network retries with the same key are safe. See [docs/SECURITY.md](./SECURITY.md#idempotency) for the full sequence diagram.

---

## Audit and session tracking

### mcp_audit_log

Every tool call is logged to `mcp_audit_log` with these fields:

| Field | Description |
|-------|-------------|
| `principal_id` | User who made the call |
| `api_key_id` / `oauth_client_id` | Which credential was used |
| `session_id` | SDK session ID (stateful) or synthetic UUID (stateless) |
| `tool_name` | Name of the tool invoked |
| `args_redacted` | Tool arguments with sensitive keys replaced |
| `result_status` | `ok`, `error`, `denied`, `rate_limited`, or `quota_exceeded` |
| `latency_ms` | Wall-clock time from context build to audit emit |
| `ip_hash` | SHA-256 of IP + salt (raw IP never stored) |
| `user_agent` | Client User-Agent header |

The table has an update-blocking trigger. Rows are append-only.

### Argument redaction

Before persisting, args pass through `redactSecrets()`:

- **12 key patterns** matched case-insensitively: token, password, secret, authorization, bearer, api_key, apikey, access_token, refresh_token, credential, private_key, jwt
- **JWT detector:** any value matching three base64url segments separated by dots is replaced with `[REDACTED_JWT]`
- **Truncation:** args are capped at 4,096 characters. Oversized payloads are replaced with `{ _truncated: true, _preview: "..." }`

### Session tracking

The `mcp_sessions` table tracks session metadata via best-effort upserts:

| Field | Description |
|-------|-------------|
| `id` | Session UUID (synthetic per-request in stateless mode) |
| `principal_id` | User who owns the session |
| `oauth_client_id` / `api_key_id` | Credential used |
| `client_name` | From `clientInfo.name` on initialize (max 200 chars) |
| `client_version` | From `clientInfo.version` on initialize (max 50 chars) |
| `ip_hash` | SHA-256 of client IP |
| `last_activity_at` | Updated on each upsert |

The session upsert runs in the background via `waitUntil` so it never adds latency to the response. The audit INSERT is awaited synchronously because it is compliance-critical.

### clientInfo sanitization

`sanitizeClientField()` strips control characters (0x00-0x1f) and HTML injection characters (`< > ' " &`) from `clientName` and `clientVersion` before storage. This prevents stored-XSS in the admin dashboard.

---

## OAuth client management

OAuth clients (Claude Desktop, Cursor, etc.) are tracked in `mcp_oauth_clients`. Population is lazy: the first time a client_id authenticates via Clerk, Sharetopus inserts a row with the auto-verify rule applied.

**Table columns:** client_id, client_name, redirect_uris, trust_level (unverified | verified | blocked), revoked_at, registered_by_user_id.

Manual promote:
```sql
UPDATE mcp_oauth_clients
SET trust_level = 'verified'
WHERE client_id = 'claude_desktop_xxx';
```

Block:
```sql
UPDATE mcp_oauth_clients
SET trust_level = 'blocked'
WHERE client_id = 'malicious_client_xxx';
```

Revoke (more permanent than blocking):
```sql
UPDATE mcp_oauth_clients
SET revoked_at = now()
WHERE client_id = 'leaked_client_xxx';
```

The auth resolver refuses both `blocked` trust level and `revoked_at IS NOT NULL`. Blocked/revoked results are cached so repeated probes do not hit the database.

---

## Known limitations

- **Stateless mode only.** mcp-handler 1.1.0 forces stateless mode on both Streamable HTTP and SSE transports. No persistent sessions, no server-initiated notifications, no subscriptions. Session IDs are synthetic per-request UUIDs.
- **`generate_post_draft` requires sampling.** Clients without MCP sampling/createMessage support (some older clients) will get an error.
- **TikTok posts are async.** After `post_now` for TikTok, the content appears in `content_history` but TikTok may still be processing. The `tiktok-publish-status-poll` Inngest function and webhook receiver poll for completion.
- **`bulk_schedule` and `bulk_post_now` are MCP-only.** No REST or web UI equivalent exists yet.
- **Analytics data staleness.** `get_account_analytics` reads from `analytics_metrics`, which is not currently populated by any cron. The table exists but data depends on future implementation.

---

**See also:** [docs/SECURITY.md](./SECURITY.md) (SSRF guard, idempotency, storage quotas), [docs/AUTH.md](./AUTH.md) (principal model, auth paths), [docs/BILLING.md](./BILLING.md) (plan gates, monthly caps)

[Back to README](../README.md)

---

## Source files referenced

| File | Description |
|------|-------------|
| `src/app/api/mcp/[transport]/route.ts` | MCP route handler, rate limit, clientInfo extraction |
| `src/lib/mcp/auth/resolve.ts` | `resolveMcpPrincipal()`, token dispatch to API key or OAuth path |
| `src/lib/mcp/auth/resolvers/apiKey.ts` | API key resolution and validation |
| `src/lib/mcp/auth/resolvers/oauth.ts` | Clerk OAuth token verification |
| `src/lib/mcp/auth/resolvers/applySubscriptionGate.ts` | Subscription tier gate (blocks free/starter) |
| `src/lib/mcp/auth/oauthClientTrust.ts` | `checkOAuthClientTrust()`, lazy population, block/revoke logic |
| `src/lib/mcp/withMcpTool.ts` | `withMcpTool()` HOF, context extraction, entitlement gate, audit emit |
| `src/lib/mcp/entitlement.ts` | `entitlementFor()`, `ACTION_PLAN_GATE`, `MONTHLY_CAPS`, atomic quota RPC |
| `src/lib/mcp/audit.ts` | `logToolCall()`, argument redaction, session upsert via waitUntil |
| `src/lib/mcp/context.ts` | Context extractors (principal, sessionId, requestId, ipHash, userAgent) |
| `src/lib/mcp/toolNames.ts` | `MCP_TOOL_NAMES` array and `McpToolName` type |
| `src/lib/mcp/tools/index.ts` | Tool registration orchestrator |
| `src/lib/mcp/prompts/index.ts` | Prompt registration |
