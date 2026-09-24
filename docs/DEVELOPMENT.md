# Development

Local setup, environment configuration, and deployment for Sharetopus.

[Back to README](../README.md)

## Table of contents

- [Local dev stack](#local-dev-stack)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
  - [Clone and install](#clone-and-install)
  - [Supabase](#supabase)
  - [Clerk](#clerk)
  - [Stripe](#stripe)
  - [Inngest](#inngest)
  - [Platform OAuth apps](#platform-oauth-apps)
- [Environment variables](#environment-variables)
  - [Auth (Clerk)](#auth-clerk)
  - [Database (Supabase)](#database-supabase)
  - [Payments (Stripe)](#payments-stripe)
  - [Rate limiting (Upstash)](#rate-limiting-upstash)
  - [Background jobs (Inngest)](#background-jobs-inngest)
  - [Platform OAuth](#platform-oauth)
  - [x402 / Coinbase CDP](#x402--coinbase-cdp)
  - [App config](#app-config)
- [Scripts](#scripts)
- [Type checking](#type-checking)
- [Code conventions](#code-conventions)
- [Deployment](#deployment)
- [Source files referenced](#source-files-referenced)

## Local dev stack

```mermaid
graph LR
    subgraph Local["localhost:3000"]
        App["Next.js Dev Server<br/>(Turbopack)"]
    end

    subgraph Remote["Remote Services"]
        Supabase["Supabase<br/>DB + Storage"]
        Clerk["Clerk<br/>Auth"]
        Upstash["Upstash Redis<br/>Rate limits + refresh lock"]
    end

    subgraph LocalTools["Local Tooling"]
        StripeCLI["Stripe CLI<br/>stripe listen --forward-to"]
        InngestDev["Inngest Dev Server<br/>bunx inngest-cli dev"]
    end

    App -->|"queries + storage"| Supabase
    App -->|"session verification"| Clerk
    App -->|"rate limits, token refresh lock"| Upstash
    StripeCLI -->|"forwards webhook events"| App
    InngestDev -->|"dispatches background jobs"| App
```

The Next.js dev server talks to remote Supabase, Clerk, and Upstash instances. Stripe webhooks and Inngest job dispatch run locally through their respective CLI tools.

## Prerequisites

| Dependency | Purpose |
|---|---|
| Node.js 20+ | Runtime |
| [Supabase](https://supabase.com) project | Postgres database and file storage |
| [Clerk](https://clerk.com) application | Authentication and user management |
| [Stripe](https://stripe.com) account | Subscription billing (3 products with price IDs) |
| [Inngest](https://www.inngest.com) account | Background job processing |
| [Upstash](https://upstash.com) Redis instance | API rate limiting and the per-account token refresh lock |
| Platform OAuth apps (one per platform) | LinkedIn, TikTok, Pinterest, Instagram, YouTube, X, Facebook, plus any registry provider you enable |

## Setup

### Clone and install

```bash
git clone <repo-url>
cd sharetopus
bun install

cp .env.example .env.local
# Fill in all required values (see tables below and .env.example comments)

bun run dev    # http://localhost:3000
```

### Supabase

1. Create a Supabase project.
2. Create the tables, indexes and RLS policies declared in `src/db/schema.ts` (`bunx drizzle-kit push` against the new database). The Postgres functions and triggers listed in [DATABASE.md](./DATABASE.md#functions-and-triggers) are not in that file yet and exist only in the production database.
3. Create a storage bucket named `scheduled-videos` (or set `SUPABASE_BUCKET_NAME` to your chosen name).
4. Copy the project URL, service role key, and the transaction and session pooler connection strings (dashboard, Connect) into `.env.local`.

### Clerk

1. Create a Clerk application and enable your preferred sign-in methods.
2. Add a webhook endpoint: `{FRONTEND_URL}/api/webhooks/clerk`.
3. Subscribe to events: `user.created`, `user.updated`, `user.deleted`.
4. Copy the publishable key, secret key, and webhook signing secret into `.env.local`.
5. For local development, populate `CLERK_WEBHOOK_SECRET_DEV` instead of `CLERK_WEBHOOK_SECRET`.

### Stripe

1. Create 3 products with monthly and yearly prices matching the plan config in `src/lib/types/plans.ts`.
2. Add a webhook endpoint: `{FRONTEND_URL}/api/webhooks/stripe`.
3. Subscribe to events: `customer.subscription.*`, `invoice.payment_succeeded`, `invoice.payment_failed`.
4. Copy the secret key and webhook signing secret into `.env.local`. Checkout is Stripe-hosted, so no publishable key is needed.
5. For local webhook testing, install the [Stripe CLI](https://stripe.com/docs/stripe-cli) and run:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

### Inngest

1. Get your event key and signing key from the Inngest dashboard.
2. For local development, start the dev server:

```bash
bunx inngest-cli@latest dev
```

3. The Inngest serve endpoint is at `/api/inngest`.

### Platform OAuth apps

Each platform requires an OAuth app with its redirect URL set to `{FRONTEND_URL}/api/social/{platform}/connect`.

| Platform | Redirect URL (local) | Notes |
|---|---|---|
| LinkedIn | `http://localhost:3000/api/social/linkedin/connect` | Standard OAuth |
| TikTok | `http://localhost:3000/api/social/tiktok/connect` | Requires separate dev/prod credentials (`TIKTOK_CLIENT_KEY_DEV`, `TIKTOK_CLIENT_SECRET_DEV`) |
| Pinterest | `http://localhost:3000/api/social/pinterest/connect` | Standard OAuth |
| Instagram | `http://localhost:3000/api/social/instagram/connect` | Use the "Instagram Login" product on Meta, not "Facebook Login" |
| YouTube | `http://localhost:3000/api/social/youtube/connect` | Google Cloud OAuth client, YouTube Data API v3 enabled |
| X | `http://localhost:3000/api/social/x/connect` | OAuth 2.0 confidential client (PKCE) |
| Facebook | `http://localhost:3000/api/social/facebook/connect` | Meta app with Facebook Login (Pages) |

Registry OAuth providers (Reddit, Threads, Tumblr, Twitch, Kick, Dribbble, Google Business) use `{FRONTEND_URL}/api/social/registry/{provider}/callback`; LinkedIn Pages reuses the LinkedIn app. Connections started through x402 or the REST API come back to `{FRONTEND_URL}/api/oauth/callback/{platform}`, so register that URL too (`X402_*_REDIRECT_URI`).

## Environment variables

All variables are documented in `.env.example`. The tables below group them by service.

### Auth (Clerk)

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk dashboard, API Keys |
| `CLERK_SECRET_KEY` | Yes | Clerk dashboard, API Keys |
| `CLERK_WEBHOOK_SECRET` | Prod | Webhook signing secret |
| `CLERK_WEBHOOK_SECRET_DEV` | Dev | Local dev override |

### Database (Supabase)

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Project URL |
| `SUPABASE_SERVICE_ROLE` | Yes | Service role key (server-only), used for Storage |
| `DATABASE_URL` | Yes | Transaction pooler connection string (port 6543), used by the Drizzle client in `src/db/client.ts`. Server-only |
| `SUPABASE_DB_URL` | For `db:*` scripts | Session pooler connection string (port 5432), used by drizzle-kit (`drizzle.config.ts`) |
| `SUPABASE_BUCKET_NAME` | No | Default: `scheduled-videos` |
| `SUPABASE_CUSTOM_STORAGE_DOMAIN` | No | For TikTok `supabase_direct` media mode |

### Payments (Stripe)

| Variable | Required | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | Yes | Stripe dashboard |
| `STRIPE_WEBHOOK_SECRET` | Prod | Webhook signing secret |
| `STRIPE_WEBHOOK_SECRET_DEV` | Dev | Local dev override |

### Rate limiting (Upstash)

| Variable | Required | Notes |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Yes | Upstash Redis REST endpoint. Also holds the token refresh lock ([PLATFORMS.md](./PLATFORMS.md#token-refresh)); without Redis, refreshes run unlocked |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Upstash Redis REST token |

### Background jobs (Inngest)

| Variable | Required | Notes |
|---|---|---|
| `INNGEST_EVENT_KEY` | Yes | Event dispatch key |
| `INNGEST_SIGNING_KEY` | Yes | Serve endpoint auth |

### Platform OAuth

| Variable | Required | Notes |
|---|---|---|
| `LINKEDIN_CLIENT_ID` | Per platform | LinkedIn OAuth app |
| `LINKEDIN_CLIENT_SECRET` | Per platform | LinkedIn OAuth app |
| `LINKEDIN_REDIRECT_URL` | Per platform | Default: `http://localhost:3000/api/social/linkedin/connect` |
| `TIKTOK_CLIENT_KEY` | Prod | Production TikTok app |
| `TIKTOK_CLIENT_SECRET` | Prod | Production TikTok app |
| `TIKTOK_CLIENT_KEY_DEV` | Dev | Sandbox TikTok app |
| `TIKTOK_CLIENT_SECRET_DEV` | Dev | Sandbox TikTok app |
| `TIKTOK_REDIRECT_URL` | Per platform | Default: `http://localhost:3000/api/social/tiktok/connect` |
| `TIKTOK_MEDIA_SOURCE` | No | `proxy` (default) or `supabase_direct` |
| `PINTEREST_CLIENT_ID` | Per platform | Pinterest OAuth app |
| `PINTEREST_CLIENT_SECRET` | Per platform | Pinterest OAuth app |
| `PINTEREST_REDIRECT_URL` | Per platform | Default: `http://localhost:3000/api/social/pinterest/connect` |
| `INSTAGRAM_CLIENT_ID` | Per platform | Meta app with Instagram Login |
| `INSTAGRAM_CLIENT_SECRET` | Per platform | Meta app with Instagram Login |
| `INSTAGRAM_REDIRECT_URL` | Per platform | Default: `http://localhost:3000/api/social/instagram/connect` |
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URL` | Per platform | Google Cloud OAuth client |
| `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URL` | Per platform | X OAuth 2.0 app |
| `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`, `FACEBOOK_REDIRECT_URL` | Per platform | Meta app with Facebook Login |
| `REDDIT_*`, `THREADS_*`, `TUMBLR_*`, `TWITCH_*`, `KICK_*`, `DRIBBBLE_*`, `GMB_*` (`_CLIENT_ID` and `_CLIENT_SECRET`) | Per provider | A registry provider is available only when both of its variables are set |
| `X402_{PLATFORM}_REDIRECT_URI` | For x402 and REST connects | One per legacy platform: `{FRONTEND_URL}/api/oauth/callback/{platform}` |

### x402 / Coinbase CDP

| Variable | Required | Notes |
|---|---|---|
| `CDP_API_KEY_ID` | For x402 | Coinbase CDP API key ID |
| `CDP_API_KEY_SECRET` | For x402 | Coinbase CDP API key secret |
| `CDP_WALLET_SECRET` | For x402 | CDP wallet secret |
| `X402_RECIPIENT_EVM` | For x402 | EVM wallet address for USDC payments |
| `X402_RECIPIENT_SOLANA` | For x402 | Solana wallet address for USDC payments. It must already hold a USDC token account before the first payment: the x402 client never creates the recipient's account, and the facilitator's simulation fails with `InvalidAccountData` until one exists. Receiving any USDC amount into the wallet once creates it |
| `X402_DEFAULT_NETWORK` | No | Default: `base` |
| `X402_FACILITATOR_URL` | No | Default: Coinbase hosted facilitator |
| `X402_SOLANA_RPC_URL` | Recommended | Dedicated Solana RPC (https) for refund blockhash reads. Unset falls back to the rate-limited public endpoint |
| `X402_RECIPIENT_ARC` | For Arc | Arc wallet that receives payments and signs settlements and refunds |
| `X402_ARC_KEY` | For Arc | Private key of `X402_RECIPIENT_ARC`. Sharetopus is its own facilitator on Arc, so it signs there itself; no CDP wallet can |
| `X402_ARC_RPC_URL` | No | Dedicated Arc RPC (https). Unset uses Arc's own public endpoint, which needs no key |
| `X402_FACILITATOR_SETTLE_KEY` | No | Opens `POST /api/x402/facilitator/settle` to the holder. Unset keeps settling closed to outside callers; `/supported` and `/verify` stay open either way |
| `X402_HMAC_SECRET` | For x402 connect | Signs the connection tokens of the x402 connect and reauth flows; without it they refuse before charging. 32 random bytes, hex |
| `X402_RECIPIENT_CELO` | For Celo | Celo wallet that receives payments and sends refunds |
| `X402_CELO_FACILITATOR_API_KEY` | For Celo | Celo facilitator settle key (x402.celo.org) |
| `X402_CELO_REFUND_KEY` | For Celo | Private key of `X402_RECIPIENT_CELO` |
| `X402_CELO_FACILITATOR_URL`, `X402_CELO_ATTRIBUTION_TAG` | No | Facilitator URL override; ERC-8021 attribution code on refunds |

### App config

| Variable | Required | Notes |
|---|---|---|
| `FRONTEND_URL` | Yes | Default: `http://localhost:3000` |
| `NEXT_PUBLIC_BASE_URL` | No | Default: `https://sharetopus.com` |
| `NEXT_PUBLIC_APP_URL` | No | Origin for share links and OAuth callback redirects. Default: `NEXT_PUBLIC_BASE_URL` |
| `MAX_DURATION_S`, `MAX_FILE_MB`, `POLL_WINDOW_S`, `WORKER_MAX_RETRIES`, `DISPATCHER_BATCH_SIZE`, `SIGNED_URL_TTL_S` | No | Background job tuning, see [INNGEST.md](./INNGEST.md#runtime-configuration) |
| `CRON_SECRET_KEY` | Yes | Shared secret for cron auth bypass |
| `MEDIA_PROXY_HMAC_SECRET` | Yes | 64 hex chars. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `MCP_IP_HASH_SALT` | Prod | 32 bytes base64. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |

## Scripts

| Command | Description |
|---|---|
| `bun run dev` | Start dev server with Turbopack (`next dev --turbopack`) |
| `bun run build` | Production build (`next build`) |
| `bun run start` | Start production server (`next start`) |
| `bun run lint` | Run ESLint (`next lint`) |
| `bun run db:generate` | Write a SQL migration into `drizzle/` from edits to `src/db/schema.ts` |
| `bun run db:migrate` | Apply pending migrations (see [DATABASE.md](./DATABASE.md#schema-changes)) |
| `bun run db:pull` | Read the live schema into `drizzle/`, to check for drift |

### REST API

REST API endpoints live in `src/app/api/v1/`. The OpenAPI spec is served at `/api/v1/openapi.json`. Interactive API docs (Scalar) are at `/docs/api`.

### Zod 4

REST API and MCP code both use `import { z } from "zod"` (Zod 4). The v2 MCP SDK needs Zod 4.2 or later to convert tool schemas to JSON Schema. Ids use `z.guid()` (see [REST.md](./REST.md#zod-4-and-zguid)).

### MDX docs

Pages in `src/content/docs/*.mdx` are served at `/docs/<slug>`. The `@next/mdx` loader is configured in `next.config.ts` with `pageExtensions: ["ts", "tsx", "mdx"]`.

### Build-time type checking

`typescript.ignoreBuildErrors: true` is set in `next.config.ts`. tsc runs in CI and pre-commit hooks, not during Vercel builds (OOM mitigation). Always run `bunx tsc --noEmit` locally before pushing.

## Type checking

```bash
bunx tsc --noEmit
```

`scripts/x402-smoke` is a separate package with its own `tsconfig.json` (ES2022 target, its own dependencies), so the root check excludes it. Check it on its own:

```bash
cd scripts/x402-smoke && bunx tsc -p tsconfig.json
```

No test framework is configured. Type checking is the primary automated verification step.

## Code conventions

### Errors as values

Server actions return a result object instead of throwing:

```typescript
{ success: boolean; message: string; data?: T; resetIn?: number }
```

Inngest workers throw only for retryable errors. Non-retryable failures are returned as values.

### Log prefixes

All server actions and core functions prefix log messages with the function name in brackets:

```
[schedulePostInternal] Creating post for user u_abc...
[deleteSupabaseFileAction] Removed file xyz from bucket
```

### Path aliases

`@/*` maps to `src/*` (configured in `tsconfig.json`). All imports use this alias.

### Server-only imports

`adminSupabase`, the Drizzle client (`src/db/client.ts`) and other privileged modules use the `server-only` package. Importing them from a client component triggers a build error, preventing accidental exposure of the service role key and the database connection string.

### created_via tracking

All post-creating functions accept a `createdVia` parameter with one of four values: `web`, `mcp`, `x402`, or `api`. This value is stored with every post so analytics can distinguish origin.

### requestId tracing

Web server actions generate a `requestId` at entry and thread it through batch functions. This provides a correlation ID in logs for tracing a single user action across multiple internal calls.

## Deployment

Deployed to Vercel. The `main` branch deploys to production at [sharetopus.com](https://sharetopus.com).

### Function duration

Vercel function timeout is configured per route using Next.js route segment config (`export const maxDuration`), not in `vercel.json`.

| Route | maxDuration |
|---|---|
| `src/app/api/mcp/mcp/route.ts` | 300s |
| `src/app/api/inngest/route.ts` | 300s |
| `src/app/api/x402/register/route.ts` | 60s |
| `src/app/api/x402/connect/route.ts` | 60s |
| All other routes | Vercel default |

### Dev/prod environment strategy

Development uses `.env.local` with `*_DEV` variants for webhook secrets and platform credentials:

- `CLERK_WEBHOOK_SECRET_DEV` instead of `CLERK_WEBHOOK_SECRET`
- `STRIPE_WEBHOOK_SECRET_DEV` instead of `STRIPE_WEBHOOK_SECRET`
- `TIKTOK_CLIENT_KEY_DEV` / `TIKTOK_CLIENT_SECRET_DEV` instead of `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`

Production uses Vercel environment variables with production keys. `NODE_ENV=production` selects production Stripe price IDs.

## Source files referenced

| File | What it contains |
|---|---|
| `package.json` | Scripts, dependencies |
| `tsconfig.json` | Path aliases, compiler options |
| `vercel.json` | Vercel deployment configuration |
| `drizzle.config.ts` | drizzle-kit settings for the `db:*` scripts |
| `src/db/schema.ts`, `src/db/client.ts` | Database schema and Drizzle client |
| `.env.example` | Full list of environment variables with documentation |
| `src/lib/types/plans.ts` | Stripe product and price ID configuration |
| `src/app/api/mcp/mcp/route.ts` | MCP server route (maxDuration 300) |
| `src/app/api/inngest/route.ts` | Inngest serve endpoint (maxDuration 300) |
| `src/app/api/webhooks/clerk/route.ts` | Clerk webhook handler |
| `src/app/api/webhooks/stripe/route.ts` | Stripe webhook handler |
| `src/app/api/webhooks/tiktok/publish/route.ts` | TikTok publish status webhook handler |
| `src/lib/jobs/runtimeConfig.ts` | Runtime constants including max duration |
| `src/app/api/v1/` | REST API v1 route handlers |
| `src/app/api/v1/openapi.json/route.ts` | OpenAPI spec endpoint |
| `src/lib/api/rest/` | REST API middleware, auth, DTOs, validation, webhooks |
| `src/content/docs/` | MDX documentation pages (served at /docs/<slug>) |
| `next.config.ts` | MDX loader, pageExtensions, typescript.ignoreBuildErrors |

---

See also: [ARCHITECTURE.md](./ARCHITECTURE.md), [MCP.md](./MCP.md), [ROADMAP.md](./ROADMAP.md)

[Back to README](../README.md)
