# Configuration

Full environment variable reference and config file details for Sharetopus.

## Environment Variables

There is no `.env.example` file in the repository. Create a `.env.local` file at the project root and populate the variables below.

### Clerk (Authentication)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | (none) | Clerk publishable key (client-side). From the Clerk dashboard. |
| `CLERK_SECRET_KEY` | Yes | (none) | Clerk secret key (server-side). From the Clerk dashboard. |
| `CLERK_WEBHOOK_SECRET` | Yes (prod) | (none) | Signing secret for verifying Clerk webhook payloads in production. |
| `CLERK_WEBHOOK_SECRET_DEV` | Yes (dev) | (none) | Signing secret for verifying Clerk webhook payloads in local development. |

### Supabase (Database and Storage)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | (none) | Supabase project URL (client-side). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | (none) | Supabase anonymous/public key (client-side). |
| `SUPABASE_SERVICE_ROLE` | Yes | (none) | Supabase service role key (server-side, bypasses RLS). |

### Stripe (Payments)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STRIPE_SECRET_KEY` | Yes | (none) | Stripe secret API key (server-side). |
| `STRIPE_PUBLISHABLE_KEY` | Yes | (none) | Stripe publishable API key (client-side, used by Stripe SDK). |
| `STRIPE_WEBHOOK_SECRET` | Yes (prod) | (none) | Signing secret for verifying Stripe webhook payloads in production. |
| `STRIPE_WEBHOOK_SECRET_DEV` | Yes (dev) | (none) | Signing secret for verifying Stripe webhook payloads in local development. From `stripe listen` CLI output. |

### Upstash (Rate Limiting and Scheduling)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `UPSTASH_REDIS_REST_URL` | Yes | (none) | Upstash Redis REST endpoint URL. |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | (none) | Upstash Redis REST authentication token. |
| `QSTASH_TOKEN` | Yes | (none) | Upstash QStash token for scheduling post delivery. |

### Social OAuth (Platform Developer Apps)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LINKEDIN_CLIENT_ID` | Yes | (none) | LinkedIn developer app client ID. |
| `LINKEDIN_CLIENT_SECRET` | Yes | (none) | LinkedIn developer app client secret. |
| `LINKEDIN_REDIRECT_URL` | Yes | (none) | OAuth redirect URL registered with LinkedIn. |
| `TIKTOK_CLIENT_KEY` | Yes | (none) | TikTok developer app client key (production). |
| `TIKTOK_CLIENT_KEY_DEV` | No | (none) | TikTok developer app client key (development/sandbox). |
| `TIKTOK_CLIENT_SECRET` | Yes | (none) | TikTok developer app client secret (production). |
| `TIKTOK_CLIENT_SECRET_DEV` | No | (none) | TikTok developer app client secret (development/sandbox). |
| `TIKTOK_REDIRECT_URL` | Yes | (none) | OAuth redirect URL registered with TikTok. |
| `PINTEREST_CLIENT_ID` | Yes | (none) | Pinterest developer app client ID. |
| `PINTEREST_CLIENT_SECRET` | Yes | (none) | Pinterest developer app client secret. |
| `PINTEREST_REDIRECT_URL` | Yes | (none) | OAuth redirect URL registered with Pinterest. |
| `INSTAGRAM_CLIENT_ID` | Yes | (none) | Instagram/Meta developer app client ID. |
| `INSTAGRAM_CLIENT_SECRET` | Yes | (none) | Instagram/Meta developer app client secret. |
| `INSTAGRAM_REDIRECT_URL` | Yes | (none) | OAuth redirect URL registered with Instagram/Meta. |

### App (General)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_BASE_URL` | Yes | (none) | Public-facing base URL of the app (e.g., `https://sharetopus.com` or `http://localhost:3000`). Used client-side. |
| `FRONTEND_URL` | Yes | (none) | Base URL used server-side for constructing redirect URLs and links. |
| `CRON_SECRET_KEY` | Yes | (none) | Bearer token for authenticating the cron endpoint `POST /api/cron/process-scheduled-posts`. |
| `NODE_ENV` | No | `development` | Standard Node.js environment variable. Set automatically by Next.js. |

## Config Files

### `next.config.ts`

- **Server Actions body size limit:** `5mb` (set via `experimental.serverActions.bodySizeLimit`).
- **Image remote patterns:** Allows Next.js `<Image>` to load from these external hosts:
  - `**.tiktok**.com` (TikTok CDN)
  - `i.pinimg.com` (Pinterest images)
  - `media.licdn.com` (LinkedIn media)
  - `qgotbtbdouetxjjdoysz.supabase.co` (Supabase storage)
  - `scontent-iad3-2.cdninstagram.com` (Instagram CDN)

### `vercel.json`

- **Function timeout:** 60 seconds for all routes matching `src/app/api/direct/**/*.ts`. This extended timeout supports direct-publish endpoints that upload media to social platforms.

### `i18n-config.ts`

- **Default locale:** `fr`
- **Supported locales:** `fr`, `en`, `es`
- **Locale detection:** enabled
- **Note:** No translation files exist in the repository. The entire UI is English. The config is declared but not actively used.

### `next-sitemap.config.js`

- **Site URL:** `https://sharetopus.com`
- `generateRobotsTxt` is commented out (disabled).

### `components.json`

- **shadcn/ui style:** `new-york`
- **RSC:** enabled (`true`)
- **TSX:** enabled (`true`)
- **Tailwind base color:** `zinc`
- **CSS variables:** enabled
- **Icon library:** `lucide`
- **Alias paths:** `@/components`, `@/lib/utils`, `@/components/ui`, `@/lib`, `@/hooks`

---

[Back to Getting Started](./README.md) | [Back to docs](../README.md) | [Back to project README](../../README.md)
