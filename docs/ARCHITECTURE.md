# Architecture

System architecture for Sharetopus: a Next.js 16 SaaS app with an MCP server, Inngest background jobs, and integrations with 4 social platforms.

292 TypeScript source files. 24 API routes. 29 database tables. 18 MCP tools.

[Back to README](../README.md)

## System overview

```mermaid
graph TD
    subgraph Client["Client Layer"]
        Browser["React 19 SPA (App Router)"]
        AI["AI Agents (Claude Desktop, Cursor)"]
    end

    subgraph Edge["Edge / Middleware"]
        ClerkMW["Clerk Middleware (src/middleware.ts)"]
    end

    subgraph Server["Next.js Server (Vercel, 300s max)"]
        subgraph Actions["Server Actions"]
            PubActions["Public Actions (auth + rate limit)"]
            IntActions["Internal Actions (no auth, MCP use)"]
        end
        subgraph API["API Routes (24 endpoints)"]
            SocialRoutes["Social OAuth + Post Routes"]
            StorageRoutes["Storage URL Routes"]
            WebhookRoutes["Webhook Handlers (Clerk, Stripe)"]
            PostStatus["Post Status Polling"]
        end
        subgraph MCP["MCP Server"]
            MCPRoute["POST /api/mcp/mcp"]
            MCPAuth["withMcpAuth (Bearer token)"]
            MCPTools["18 Tools"]
            MCPRes["3 Resources"]
            MCPPrompts["3 Prompts"]
        end
    end

    subgraph Background["Background (Inngest)"]
        Dispatcher["scheduled-posts-tick (cron 5min)"]
        Worker["process-single-post (event)"]
        DirectWorker["process-direct-post (event)"]
        TikTokPoll["tiktok-publish-status-poll (event)"]
        StuckSweep["sweep-stuck-direct-posts (cron 5min)"]
        OrphanSweep["sweep-orphan-storage-files (cron daily)"]
    end

    subgraph Data["Data Layer"]
        Supabase["Supabase Postgres (29 tables)"]
        Storage["Supabase Storage (scheduled-videos)"]
        Redis["Upstash Redis (rate limits)"]
    end

    subgraph External["External Services"]
        Clerk["Clerk (Auth + Webhooks)"]
        Stripe["Stripe (Billing + Webhooks)"]
        LI["LinkedIn v2"]
        TK["TikTok v2"]
        PI["Pinterest v5"]
        IG["Instagram Graph v23"]
    end

    Browser --> ClerkMW --> Actions
    AI --> MCPRoute
    MCPRoute --> MCPAuth --> MCPTools
    MCPTools --> IntActions
    PubActions --> Supabase
    PubActions --> Redis
    IntActions --> Supabase
    Actions --> StorageRoutes
    StorageRoutes --> Storage
    Dispatcher --> Worker
    Worker --> LI & TK & PI & IG
    DirectWorker --> LI & TK & PI & IG
    TikTokPoll --> TK
    StuckSweep --> Supabase
    OrphanSweep --> Storage
    Clerk -->|webhooks| WebhookRoutes
    Stripe -->|webhooks| WebhookRoutes
    WebhookRoutes --> Supabase
```

## Directory structure

```
src/
  actions/
    api/
      adminSupabase.ts          # Supabase client with service role (bypasses RLS)
    client/
      signedUrlUpload.ts        # Client-side XHR upload with progress
    server/
      _internal/                # No-auth actions consumed by MCP tools
        contentHistoryActions/  # getContentHistoryInternal
        data/                   # deleteSupabaseFileAction, fetchSocialAccounts
        scheduleActions/        # schedulePost, cancel, resume, update, delete, get
      accounts/                 # disconnectSocialAccount
      connections/              # checkAccountLimits (plan-gated)
      contentHistoryActions/    # storeContentHistory, storeFailedPost, getContentHistory
      data/                     # generateServerSignedUploadUrl, pendingDirectPosts,
                                # pendingTikTokPulls, mcpSessions, orphanStorageSweep,
                                # getServerSignedViewUrl, getSupabaseVideoFile
      mcp/                      # createApiKey, listApiKeys, revokeApiKey
      rateLimit/                # checkRateLimit (Upstash sliding window)
      scheduleActions/          # Public wrappers: auth + rate limit + delegate to _internal
      stripe/                   # checkOutSession, checkUserSubscription, customerPortal
  app/
    (marketing)/                # Landing page, Privacy Policy, ToS
    (protected)/                # Authenticated routes
      connections/              # Social account management
      create/                   # Post creation (text/image/video)
      integrations/             # Integration status page
      payment/                  # Checkout + success page
      posted/                   # Content history view
      scheduled/                # Scheduled posts view
      studio/                   # Analytics (Coming Soon)
      userProfile/              # Clerk user profile
    .well-known/
      oauth-protected-resource/ # RFC 9728 OAuth discovery for MCP clients
    api/
      auth/[clerk]/             # Clerk auth UI
      inngest/                  # Inngest serve() endpoint (6 functions)
      mcp/[transport]/          # MCP server (Streamable HTTP + SSE)
      media/                    # HMAC-signed media proxy
      posts/status/             # Inngest job status polling (max 50 event IDs)
      social/
        {platform}/connect/     # OAuth callback handler
        {platform}/initiate/    # OAuth initiation redirect
        {platform}/post/        # Direct post endpoint
        {platform}/process/     # Schedule processing endpoint
      storage/
        generate-upload-url/    # Signed upload URL (Clerk-authed)
        generate-view-url/      # Signed view URL (Clerk-authed, 5min TTL)
      webhooks/
        clerk/                  # user.created, user.updated, user.deleted
        stripe/                 # subscription.*, invoice.*
  components/
    core/
      create/                   # Post creation form, media upload, validation
        action/
          handleSocialMediaPost/  # Main posting handler (direct + scheduled)
          media/                  # Upload helpers
        SocialPostForm/           # Form UI, hooks, validation, state
      scheduled/                # Scheduled posts table, reschedule dialog
      posted/                   # Content history table
      accounts/                 # Connect accounts button, account list
    marketing-page/             # Hero, comparison, details, nav
    sidebar/                    # App navigation
    ui/                         # shadcn/ui components
  inngest/
    client.ts                   # Inngest client (id: "sharetopus")
    functions/
      scheduledPostsTick.ts     # Cron: dispatch due scheduled posts
      processSinglePost.ts      # Event: process one scheduled post
      processDirectPost.ts      # Event: process one direct post
      tikTokPublishStatusPoll.ts # Event: poll TikTok publish status
      sweepStuckDirectPosts.ts  # Cron: recover stuck pending_direct_posts
      sweepOrphanStorageFiles.ts # Cron: delete unreferenced storage files
      platformErrors.ts         # Error classification (retryable vs terminal)
  lib/
    api/
      _shared/
        buildStreamingMultipartFormDataBody.ts  # Streaming S3 upload for Pinterest
        directPostForAccountsGeneric.ts        # Generic direct-post adapter (all 4 platforms)
        processAccountsGeneric.ts              # Generic multi-account processor
        scheduleForAccountGeneric.ts           # Generic scheduler
      instagram/                # OAuth, posting, scheduling, data helpers
      linkedin/                 # OAuth, posting, scheduling, data helpers
      pinterest/                # OAuth, posting (streaming video), scheduling
      tiktok/                   # OAuth, posting (async pull), scheduling
      inngest/                  # Inngest API helpers
    jobs/
      runtimeConfig.ts          # Runtime tuning (concurrency, timeouts, batch sizes)
    mcp/
      auth.ts                   # resolveMcpPrincipal (API key + OAuth paths)
      audit.ts                  # logToolCall, arg redaction, session upsert
      context.ts                # extractPrincipal, extractSessionId, extractIpHash
      entitlement.ts            # Plan gating + monthly quota enforcement
      ipHash.ts                 # SHA-256 IP hashing with configurable salt
      _shared/                  # safeUserFetch, enforceStorageQuota, currentQuotaPeriod
      tools/                    # 18 tool definitions (one file per tool)
      resources/                # 3 resource definitions
      prompts/                  # 3 prompt definitions
    types/
      database.types.ts         # Generated Supabase types (29 tables)
      plans.ts                  # Plan tiers, price IDs, account/storage limits
```

## Data flows

### Web user schedules a post

```mermaid
sequenceDiagram
    participant User as Browser
    participant Form as SocialPostForm
    participant Handler as handleSocialMediaPost
    participant Process as /api/social/{platform}/process
    participant Schedule as scheduleFor{Platform}Accounts
    participant Internal as schedulePostInternal
    participant DB as Supabase

    User->>Form: Fill post content + select accounts
    Form->>Handler: Submit (isScheduled=true)
    Handler->>Handler: Clerk authCheck + rate limit (30/60s)
    Handler->>Handler: Validate content per account
    Handler->>Process: POST per platform (accounts, content, scheduledAt)
    Process->>Schedule: scheduleFor{Platform}Accounts(accounts, content)
    loop Each selected account
        Schedule->>Internal: schedulePostInternal(data, principalId, "web")
        Internal->>DB: INSERT scheduled_posts (status=scheduled, created_via=web)
    end
    DB-->>User: Success response
```

### MCP agent schedules a post

```mermaid
sequenceDiagram
    participant Agent as AI Agent
    participant MCP as /api/mcp/mcp
    participant Auth as resolveMcpPrincipal
    participant Entitle as entitlementFor
    participant Tool as schedule_post tool
    participant Internal as schedulePostInternal
    participant DB as Supabase
    participant Audit as logToolCall

    Agent->>MCP: POST {tool: schedule_post, args: {...}}
    MCP->>Auth: Bearer token
    Auth-->>MCP: McpPrincipal (principalId, plan=starter)
    MCP->>Entitle: entitlementFor(principal, "schedule_post")
    Entitle->>DB: Check + increment usage_quotas
    Entitle-->>MCP: allowed (100/mo starter)
    MCP->>Tool: execute(args, principal)
    Tool->>Internal: schedulePostInternal(data, principalId, "mcp")
    Internal->>DB: INSERT scheduled_posts (status=scheduled, created_via=mcp)
    DB-->>Tool: scheduleId
    Tool-->>MCP: {success: true, scheduleId}
    MCP->>Audit: logToolCall(principal, "schedule_post", "ok", latency)
    Audit->>DB: INSERT mcp_audit_log
    MCP-->>Agent: JSON result
```

### Inngest processes a scheduled post

```mermaid
sequenceDiagram
    participant Cron as scheduled-posts-tick (every 5min)
    participant DB as Supabase
    participant Inngest as Inngest
    participant Worker as process-single-post
    participant Platform as Platform API
    participant History as content_history

    Cron->>DB: SELECT scheduled_posts WHERE status=scheduled AND scheduled_at <= now()
    DB-->>Cron: due posts (up to 200)
    Cron->>DB: UPDATE status = queued
    Cron->>Inngest: Send post.due events (1 per post)
    Inngest->>Worker: Trigger (throttled 5/min per account)
    Worker->>DB: CAS UPDATE status = processing
    Worker->>DB: Fetch social_account (token, refresh)
    Worker->>Worker: Build signed media URL
    Worker->>Platform: Publish post
    alt Success
        Platform-->>Worker: content_id
        Worker->>DB: UPDATE status = posted
        Worker->>History: INSERT content_history
        Worker->>Worker: Cleanup media if unreferenced
    else Terminal failure
        Worker->>DB: UPDATE status = failed
        Worker->>DB: INSERT failed_posts
        Worker->>Worker: Cleanup media if unreferenced
    else Retryable (auth_expired, rate_limited, transient)
        Worker-->>Inngest: throw (triggers retry with backoff)
    end
```

### Pinterest OAuth flow

```mermaid
sequenceDiagram
    participant User as Browser
    participant Init as /api/social/pinterest/initiate
    participant Pinterest as pinterest.com/oauth
    participant Callback as /api/social/pinterest/connect
    participant Exchange as exchangePinterestCode
    participant Profile as getPinterestProfile
    participant DB as Supabase

    User->>Init: GET (click "Connect Pinterest")
    Init->>Init: Generate state token, set httpOnly cookie (15min)
    Init->>Pinterest: Redirect with scopes, state, redirect_uri
    Pinterest->>User: Login + consent screen
    User->>Pinterest: Authorize
    Pinterest->>Callback: Redirect with code + state
    Callback->>Callback: Verify state matches cookie
    Callback->>Exchange: POST /v5/oauth/token (Basic Auth, code)
    Exchange-->>Callback: access_token, refresh_token, expires_in
    Callback->>Profile: GET /v5/user_account
    Profile-->>Callback: username, follower_count, profile_image
    Callback->>DB: UPSERT social_accounts
    Callback->>User: Redirect to /connections
```

## State diagrams

### scheduled_posts.status

```mermaid
stateDiagram-v2
    [*] --> scheduled: INSERT (web, mcp, x402, api)
    scheduled --> queued: scheduled-posts-tick (cron, batch <=200)
    scheduled --> cancelled: cancel_scheduled_posts
    cancelled --> scheduled: resume_scheduled_posts
    queued --> processing: process-single-post (CAS claim)
    processing --> posted: Platform publish success
    processing --> failed: Terminal error (policy_rejected, invalid_input, unknown)
    posted --> [*]
    failed --> [*]

    note right of cancelled: resume auto-reschedules if scheduled_at is past
    note right of processing: Retryable errors (auth_expired, rate_limited, transient) throw for Inngest retry
```

### pending_direct_posts.status

```mermaid
stateDiagram-v2
    [*] --> processing: insertPendingDirectPosts (before Inngest dispatch)
    processing --> completed: process-direct-post success
    processing --> failed: process-direct-post failure
    processing --> failed: sweep-stuck-direct-posts (>10min cutoff)
    completed --> [*]
    failed --> [*]

    note right of processing: Lock row. Prevents premature media cleanup.
    note left of failed: sweep-stuck-direct-posts runs every 5 min
```

## Error handling

The codebase uses an errors-as-values pattern at service boundaries. Functions return `{ success: boolean; message: string; data?: T }` instead of throwing exceptions. This keeps error handling explicit at every call site.

```typescript
// Pattern used throughout server actions:
{ success: true, message: "Post scheduled", data: { scheduleId: "..." } }
{ success: false, message: "Rate limited", resetIn: 45 }
{ success: false, message: "Account not found" }
```

Exceptions are thrown only for retryable failures inside Inngest workers, where Inngest catches the throw and applies exponential backoff. Terminal failures (policy rejection, invalid input) are recorded and the function returns normally.

Platform errors are classified in `src/inngest/functions/platformErrors.ts`:
- **Retryable**: `auth_expired`, `rate_limited`, `transient` (network timeouts, connection resets)
- **Terminal**: `policy_rejected` (platform policy violation), `invalid_input` (wrong post type, missing board), `unknown`

## Design tradeoffs

**Principals table (unified identity).** `principals.kind` is `clerk` or `wallet`. Every other table FKs to `principal_id`, not `user_id`. This adds a join when you only care about Clerk users (which is currently all users), but it means the x402 wallet-based anonymous access path can be added without schema migration. The wallet tables exist in the schema but the code path is not built yet.

**created_via enum.** Every post-related table stores `created_via: web | mcp | x402 | api`. This was threaded through all scheduling and posting paths so analytics can distinguish origin. The cost is an extra parameter passed through several layers.

**Stateless MCP (mcp-handler 1.1.0).** The MCP server runs in stateless Streamable HTTP mode. mcp-handler 1.1.0 does not support persistent sessions across requests. Each request resolves the principal independently. The `mcp_sessions` table tracks session activity but cannot enforce session continuity. This is fine for tool calls but limits features like long-running subscriptions or server-initiated notifications.

**Internal vs public actions.** MCP tools call `_internal` actions that skip Clerk auth (the MCP auth layer already verified the principal). Public server actions add Clerk auth + rate limiting and delegate to the same `_internal` functions. This avoids double-auth but means `_internal` functions must never be imported from client components. The `server-only` package enforces this at build time.

**Admin Supabase client.** All server actions use a service-role Supabase client that bypasses RLS. This is simpler than managing RLS policies for server-side operations but means the application layer is responsible for all access control. Every action manually checks `principal_id` ownership.

**Inngest over pg_cron.** Background jobs use Inngest (hosted) instead of Postgres cron extensions. Inngest provides retry with backoff, per-account throttling, event-driven dispatch, and observability without self-hosting infrastructure. The tradeoff is a dependency on Inngest's hosted service and the 300-second Vercel function timeout ceiling.

**Streaming multipart for Pinterest video.** Pinterest requires uploading video files to S3 via multipart form-data. The `buildStreamingMultipartFormDataBody` helper streams the file chunk-by-chunk (~64KB) to avoid loading the entire video into memory. This adds complexity (Content-Length precomputation, `duplex: "half"` on fetch) but keeps memory usage bounded even for 250 MB videos.

## Tech stack

| Category | Package | Version |
|----------|---------|---------|
| Framework | next | 16.1.6 |
| React | react / react-dom | 19.2.0 |
| TypeScript | typescript | 5.9.3 |
| CSS | tailwindcss | 4.2.4 |
| Auth | @clerk/nextjs | 7.3.2 |
| MCP Auth | @clerk/mcp-tools | 0.5.0 |
| Database | @supabase/supabase-js | 2.105.3 |
| Payments | stripe | 18.5.0 |
| Background Jobs | inngest | 4.3.0 |
| Rate Limiting | @upstash/ratelimit | 2.0.8 |
| Redis | @upstash/redis | 1.38.0 |
| MCP SDK | @modelcontextprotocol/sdk | 1.29.0 |
| MCP Handler | mcp-handler | 1.1.0 |
| HTTP Client | axios | 1.16.0 |
| Validation | zod | 3.25.76 |
| UI Components | shadcn (Radix UI) | 2.10.0 |
| Date Handling | date-fns | 4.1.0 |
| ID Generation | nanoid / uuid | 5.1.11 / 11.1.1 |
| Webhooks | svix | 1.92.2 |
| Charts | recharts | 2.15.4 |
| File Upload | react-dropzone | 14.4.1 |
| Drag & Drop | @dnd-kit | core 6.3.1 |
| Deployment | Vercel | |

---

**See also:** [docs/SECURITY.md](./SECURITY.md) (security architecture, threat model), [docs/MCP.md](./MCP.md) (tool inventory, auth flow), [docs/DATABASE.md](./DATABASE.md) (schema details)

[Back to README](../README.md)
