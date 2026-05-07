# Environment Variables

Master reference for all environment variables used by Sharetopus. There is no `.env.example` file in the repo. Create a `.env.local` file at the project root and populate the required values.

Variables marked **dev** or **prod** are only needed in that environment. Variables marked **required** are needed in both.

## Clerk

| Variable | Required | Default | Source file | Description |
|----------|----------|---------|-------------|-------------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | required | -- | SDK-consumed (client) | Clerk public key for client-side auth |
| `CLERK_SECRET_KEY` | required | -- | SDK-consumed (server) | Clerk server-side secret |
| `CLERK_WEBHOOK_SECRET` | prod | -- | `src/app/api/webhooks/clerk/route.ts` | Clerk webhook signing secret (production) |
| `CLERK_WEBHOOK_SECRET_DEV` | dev | -- | `src/app/api/webhooks/clerk/route.ts` | Clerk webhook signing secret (development) |

## Supabase

| Variable | Required | Default | Source file | Description |
|----------|----------|---------|-------------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | required | -- | SDK-consumed (client) | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | required | -- | SDK-consumed (client) | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE` | required | -- | Server-side Supabase client | Supabase service role key, bypasses RLS |

## Stripe

| Variable | Required | Default | Source file | Description |
|----------|----------|---------|-------------|-------------|
| `STRIPE_SECRET_KEY` | required | -- | `src/lib/stripe.ts` | Stripe server-side secret key |
| `STRIPE_PUBLISHABLE_KEY` | required | -- | Client-side Stripe | Stripe publishable key for checkout |
| `STRIPE_WEBHOOK_SECRET` | prod | -- | `src/app/api/webhooks/stripe/route.ts` | Stripe webhook signing secret (production) |
| `STRIPE_WEBHOOK_SECRET_DEV` | dev | -- | `src/app/api/webhooks/stripe/route.ts` | Stripe webhook signing secret (development) |

## Upstash

| Variable | Required | Default | Source file | Description |
|----------|----------|---------|-------------|-------------|
| `UPSTASH_REDIS_REST_URL` | required | -- | `src/actions/api/upstash.ts` | Upstash Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | required | -- | `src/actions/api/upstash.ts` | Upstash Redis REST auth token |
| `QSTASH_TOKEN` | required | -- | `src/actions/api/qstash.ts` | QStash token for scheduled job delivery |

## LinkedIn

| Variable | Required | Default | Source file | Description |
|----------|----------|---------|-------------|-------------|
| `LINKEDIN_CLIENT_ID` | required | -- | `src/app/api/social/linkedin/initiate/route.ts` | LinkedIn app client ID |
| `LINKEDIN_CLIENT_SECRET` | required | -- | `src/lib/api/linkedin/data/exchangeLinkedInCode.ts` | LinkedIn app client secret |
| `LINKEDIN_REDIRECT_URL` | required | -- | Same files | OAuth callback URL for LinkedIn |

## TikTok

TikTok uses separate keys for dev and prod environments.

| Variable | Required | Default | Source file | Description |
|----------|----------|---------|-------------|-------------|
| `TIKTOK_CLIENT_KEY` | prod | -- | `src/app/api/social/tiktok/initiate/route.ts` | TikTok app client key (production) |
| `TIKTOK_CLIENT_SECRET` | prod | -- | `src/lib/api/tiktok/data/exchangeTikTokCode.ts` | TikTok app client secret (production) |
| `TIKTOK_CLIENT_KEY_DEV` | dev | -- | Same files | TikTok app client key (development) |
| `TIKTOK_CLIENT_SECRET_DEV` | dev | -- | Same files | TikTok app client secret (development) |
| `TIKTOK_REDIRECT_URL` | required | -- | Same files | OAuth callback URL for TikTok |

## Pinterest

| Variable | Required | Default | Source file | Description |
|----------|----------|---------|-------------|-------------|
| `PINTEREST_CLIENT_ID` | required | -- | `src/app/api/social/pinterest/initiate/route.ts` | Pinterest app client ID |
| `PINTEREST_CLIENT_SECRET` | required | -- | `src/lib/api/pinterest/data/exchangePinterestCode.ts` | Pinterest app client secret |
| `PINTEREST_REDIRECT_URL` | required | -- | Same files | OAuth callback URL for Pinterest |

## Instagram

| Variable | Required | Default | Source file | Description |
|----------|----------|---------|-------------|-------------|
| `INSTAGRAM_CLIENT_ID` | required | -- | `src/app/api/social/instagram/initiate/route.ts` | Instagram app client ID |
| `INSTAGRAM_CLIENT_SECRET` | required | -- | `src/lib/api/instagram/data/exchangeInstagramCode.ts` | Instagram app client secret |
| `INSTAGRAM_REDIRECT_URL` | required | -- | Same files | OAuth callback URL for Instagram |

## App

| Variable | Required | Default | Source file | Description |
|----------|----------|---------|-------------|-------------|
| `FRONTEND_URL` | required | -- | Multiple files | Base URL used for OAuth callback construction |
| `CRON_SECRET_KEY` | required | -- | `src/app/api/cron/process-scheduled-posts/route.ts` | Bearer token for the cron endpoint |
| `NEXT_PUBLIC_BASE_URL` | optional | `https://sharetopus.com` | McpDocsCard component | Public base URL shown in the MCP docs card |
| `NODE_ENV` | auto | -- | Next.js runtime | Set automatically; controls dev/prod key selection |

---

[Back to Reference](./README.md) | [Back to docs](../README.md) | [Back to project root](../../README.md)
