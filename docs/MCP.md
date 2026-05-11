# MCP Server

Sharetopus exposes an MCP server via two transports:
- **Streamable HTTP:** `https://sharetopus.com/api/mcp/mcp`
- **SSE:** `https://sharetopus.com/api/mcp/sse`

Both transports run in stateless mode (mcp-handler 1.1.0 does not support persistent sessions). AI agents (Claude Desktop, Cursor, ChatGPT) can schedule posts, manage content, and query analytics on behalf of authenticated subscribers.

Built with mcp-handler 1.1.0 and @modelcontextprotocol/sdk 1.29.0.

[Back to README](../README.md)

## Authentication

Two auth paths, both resolving to a `principal_id` with a cached subscription tier.

```mermaid
sequenceDiagram
    participant Agent as AI Agent
    participant MCP as /api/mcp/mcp
    participant Auth as resolveMcpPrincipal

    Agent->>MCP: POST with Bearer token

    alt Token starts with stp_mcp_
        Auth->>Auth: SHA-256 hash token
        Auth->>Auth: Lookup token_hash in api_keys table
        Auth->>Auth: Check: not revoked, not expired
        Auth->>Auth: Update last_used_at
        Auth-->>MCP: McpPrincipal (kind=apikey, principalId, scopes, plan)
    else Clerk OAuth token
        Auth->>Auth: Verify JWT via Clerk SDK
        Auth->>Auth: Resolve principalId from Clerk userId
        Auth-->>MCP: McpPrincipal (kind=oauth, principalId, plan)
    end

    MCP->>MCP: Subscription gate (free tier blocked)
    MCP->>MCP: Inject principal into tool context
```

### Generating an API key

1. Open the Sharetopus web app and navigate to Settings or Integrations
2. Click "Create MCP API Key", give it a name
3. Copy the key (shown once, format: `stp_mcp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)
4. Store it in your MCP client config as a Bearer token

Limits: 10 active MCP keys per user. Keys can be revoked from the UI. Requires an active subscription (Starter or above).

### Connecting from Claude Desktop

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

For Clerk OAuth (if your client supports OAuth discovery):

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

## Tool inventory

18 tools across 4 tiers. Quota enforcement is atomic (Postgres RPC `atomic_increment_quota`). Write tools that create posts support idempotent retries via `idempotency_key` (see [Idempotency](#idempotency) below). All tools carry [Connectors Directory annotations](#tool-annotations).

| Tool | Type | Tier | Monthly Quota | Rate Limit | Description |
|------|------|------|---------------|------------|-------------|
| `list_connections` | Read | Free | - | - | List connected social accounts with platform and status |
| `list_pinterest_boards` | Read | Free | - | - | List Pinterest boards for an account (paginated) |
| `list_scheduled_posts` | Read | Free | - | - | List scheduled posts, optional filter by platform/status |
| `list_content_history` | Read | Free | - | - | View posted content history, optional platform filter |
| `list_billing_summary` | Read | Free | - | - | View subscription plan, status, and monthly usage counts |
| `request_account_reauth_link` | Read | Free | - | - | Get re-auth URL for an account with expired token |
| `schedule_post` | Write | Starter+ | 100 / 500 / unlimited | - | Schedule a post for future publishing |
| `post_now` | Write | Starter+ | 100 / 500 / unlimited | - | Publish a post immediately via Inngest event |
| `cancel_scheduled_posts` | Write | Starter+ | - | - | Cancel 1-50 scheduled posts |
| `resume_scheduled_posts` | Write | Starter+ | - | - | Resume cancelled posts (past dates rescheduled +1h) |
| `reschedule_posts` | Write | Starter+ | - | - | Change scheduled time for 1-50 posts |
| `delete_scheduled_posts` | Write | Starter+ | - | - | Permanently delete 1-50 posts + cleanup orphan media |
| `attach_media_from_url` | Write | Starter+ | 100 / 500 / unlimited | 10/60s | Download from URL, upload to storage. SSRF-guarded. |
| `request_upload_url` | Write | Starter+ | 100 / 500 / unlimited | 20/60s | Get signed upload URL for direct media upload |
| `bulk_schedule` | Write | Creator+ | 200 / unlimited | - | Schedule up to 30 posts at once with idempotency |
| `bulk_post_now` | Write | Creator+ | 500 / unlimited | - | Publish up to 30 posts immediately with idempotency |
| `get_account_analytics` | Read | Creator+ | - | - | Fetch metrics (views, likes, comments, shares) |
| `generate_post_draft` | Read | Pro | 100/mo | - | Generate draft via client LLM (zero API cost) |

## Tool details

### list_connections

List connected social accounts. Returns platform, display name, availability status. Tokens are stripped from the response.

**Parameters:**
```
include_unavailable  boolean  optional  default: false
  Include accounts that are disconnected or have expired tokens
```

**Returns:** Array of social account objects (id, platform, display_name, username, avatar_url, is_available).

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

**Monthly quota:** 100 (starter), 500 (creator), unlimited (pro).

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

**Returns:** `{ success, upload_url, storage_path, token, expires_in_seconds }`.

---

### bulk_schedule

Schedule up to 30 posts at once. Requires Creator plan or higher. Each post gets an `idempotency_key` of `${batchId}:${index}`, making retries safe.

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

**Preflight checks:** entitlement verification, platform daily quota enforcement (next 24h), social account ownership (single bulk query).

**Returns:** `{ batch_id, total, succeeded, failed, results: [...] }`.

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

### bulk_post_now

Publish up to 30 posts immediately in one call. Each post dispatches a separate Inngest `post.now` event. Requires Creator plan or higher.

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

**Preflight checks:** entitlement verification, social account ownership (single bulk query), caption length validation per platform, Pinterest board requirement.

**Returns:** `{ success, batch_id, dispatched, total, results: [{ index, platform, social_account_id, event_id }] }`.

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

Generate a draft post using the client's LLM. The tool returns a structured prompt; the client's model generates the draft. Zero API cost to the Sharetopus account.

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

**Returns:** Structured prompt object. Clients without MCP sampling support receive an error.

## Resources

3 read-only resources. Same entitlement checks as corresponding tools. Return empty contents if the user's plan doesn't qualify.

| URI | MIME Type | Description |
|-----|-----------|-------------|
| `mcp://sharetopus/scheduled-posts` | application/json | Scheduled posts (limit 100) |
| `mcp://sharetopus/connections` | application/json | Connected social accounts (tokens stripped) |
| `mcp://sharetopus/content-history` | application/json | Published content history (limit 100) |

## Prompts

3 reusable message templates that guide agent workflows.

| Prompt | Parameters | Purpose |
|--------|-----------|---------|
| `plan_week_for_platform` | platform, theme | Plan 5-7 posts around a theme for a specific platform |
| `repurpose_post` | post_id, target_platforms (comma-separated) | Fetch a post and adapt it for multiple platforms |
| `audit_calendar` | (none) | Audit the next 14 days of scheduled posts for gaps and imbalances |

## Usage examples

### Example 1: Schedule a Pinterest post for tomorrow

User prompt to agent: "Schedule a Pinterest post for tomorrow at 10am with this image: https://example.com/photo.jpg"

Tool call sequence:
1. `list_connections` to find the Pinterest account ID
2. `attach_media_from_url(url: "https://example.com/photo.jpg")` to upload the image
3. `schedule_post(social_account_id: "...", platform: "pinterest", scheduled_at: "2026-05-11T10:00:00Z", post_type: "image", description: "...", media_storage_path: "user_xxxx/abc123.jpg")`

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
3. `reschedule_posts(post_ids: ["id1", "id2", "id3"], new_scheduled_time: "2026-05-18T09:00:00Z")`

Note: `reschedule_posts` also resumes cancelled posts, so if some were already cancelled, they get resumed with the new time.

### Example 4: Plan a week of LinkedIn content

User prompt: "Help me plan a week of LinkedIn posts about developer productivity"

The agent can use the `plan_week_for_platform` prompt:
1. Agent invokes the prompt with `platform: "linkedin"`, `theme: "developer productivity"`
2. The prompt returns a structured message guiding the agent to create 5-7 posts
3. Agent generates drafts (optionally using `generate_post_draft` for Pro users)
4. Agent calls `bulk_schedule` to schedule all posts at once

## MCP request lifecycle

```mermaid
sequenceDiagram
    participant A as Agent
    participant R as /api/mcp/[transport]
    participant Auth as resolveMcpPrincipal
    participant Ent as entitlementFor
    participant Tool as Tool handler
    participant DB as Supabase
    participant Audit as logToolCall

    A->>R: POST initialize {clientInfo}
    R->>R: Parse body, extract clientName + clientVersion
    R->>Auth: Resolve principal (API key or OAuth)
    Auth-->>R: McpPrincipal
    R->>DB: Upsert mcp_sessions (client_name, client_version)
    R-->>A: Server capabilities

    A->>R: POST tools/call {name, arguments}
    R->>Auth: Resolve principal
    R->>Ent: entitlementFor(principal, action)
    alt deny (no_subscription / plan_too_low / monthly_quota)
        Ent-->>R: deny
        R->>Audit: Log denied / quota_exceeded
        R-->>A: Error with deny reason
    else allow
        R->>Tool: Execute tool(args, principal)
        Tool->>Tool: Rate limit check (if applicable)
        Tool->>Tool: Idempotency pre-check (if key provided)
        Tool->>DB: Query / mutate
        DB-->>Tool: Result
        Tool-->>R: Tool result
        R->>Audit: Log ok + latency_ms
        R-->>A: JSON result
    end
```

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

## Idempotency

Three tools accept an explicit `idempotency_key` parameter for safe retries. A fourth uses a derived key.

| Tool | Key source | DB constraint |
|------|-----------|---------------|
| `schedule_post` | `idempotency_key` param | UNIQUE on `(principal_id, idempotency_key)` in `scheduled_posts` |
| `post_now` | `idempotency_key` param | UNIQUE on `(principal_id, idempotency_key)` in `pending_direct_posts` |
| `bulk_post_now` | Derived: `${batch_id}:${index}` | Same as `post_now` |
| `bulk_schedule` | Derived: `${batch_id}:${index}` | Same as `schedule_post` |

All four use `INSERT ... ON CONFLICT DO NOTHING`. If the insert conflicts, the handler fetches the existing row and returns its ID with a message like "already dispatched". Network retries with the same key are safe. See [docs/SECURITY.md](./SECURITY.md#idempotency) for the full sequence diagram.

## Audit and session tracking

Every tool call is logged to `mcp_audit_log` with:
- principal_id, api_key_id or oauth_client_id
- session_id (SDK session ID for stateful transports, synthetic UUID for stateless)
- tool_name, args_redacted (sensitive keys like token/password/secret are replaced with `[REDACTED]`)
- result_status: `ok`, `error`, `denied`, `rate_limited`, `quota_exceeded`
- latency_ms, ip_hash (SHA-256 of IP + salt, raw IP never stored), user_agent

The `mcp_sessions` table tracks session metadata via best-effort upserts. On `initialize` requests, the route handler extracts `clientInfo.name` (capped at 200 chars) and `clientInfo.version` (capped at 50 chars) from the JSON-RPC params and stores them as `client_name` and `client_version`. This identifies which AI client (Claude Desktop, Cursor, etc.) made each session.

The `mcp_audit_log` table has an update-blocking trigger. Rows are append-only.

## Known limitations

- **Stateless mode only.** mcp-handler 1.1.0 forces stateless mode on both Streamable HTTP and SSE transports. No persistent sessions, no server-initiated notifications, no subscriptions. Session IDs are synthetic per-request UUIDs.
- **`generate_post_draft` requires sampling.** Clients without MCP sampling/createMessage support (some older clients) will get an error.
- **TikTok posts are async.** After `post_now` for TikTok, the content appears in `content_history` but TikTok may still be processing. The `tiktok-publish-status-poll` Inngest function polls for completion.
- **`bulk_schedule` and `bulk_post_now` are MCP-only.** No REST or web UI equivalent exists yet.
- **Analytics data staleness.** `get_account_analytics` reads from `analytics_metrics`, which is not currently populated by any cron. The table exists but data depends on future implementation.

---

**See also:** [docs/SECURITY.md](./SECURITY.md) (SSRF guard, idempotency, storage quotas), [docs/AUTH.md](./AUTH.md) (principal model, auth paths), [docs/BILLING.md](./BILLING.md) (plan gates, monthly caps)

[Back to README](../README.md)
