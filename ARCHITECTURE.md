# Sharetopus: Architecture Document

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Browser)                               │
│                                                                             │
│   Next.js App Router (React 19)  ←→  Clerk Auth  ←→  Stripe Checkout       │
│         │              │                                                    │
│   Marketing Pages   Protected Dashboard (sidebar layout)                    │
│                        ├── /create (text/image/video)                       │
│                        ├── /connections                                      │
│                        ├── /scheduled                                        │
│                        ├── /posted                                           │
│                        └── /studio (coming soon)                             │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
                    HTTPS (Server Actions + API Routes)
                                │
┌───────────────────────────────▼─────────────────────────────────────────────┐
│                         NEXT.JS SERVER (Vercel)                             │
│                                                                             │
│   ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│   │  Middleware  │  │  API Routes  │  │   Server     │  │   Webhooks    │  │
│   │  (Clerk)    │  │  /api/social  │  │   Actions    │  │  /api/webhooks│  │
│   └──────┬──────┘  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│          │                │                  │                   │          │
│          ▼                ▼                  ▼                   ▼          │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │                        Service Layer                                │  │
│   │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │  │
│   │  │ LinkedIn  │  │ TikTok   │  │Pinterest │  │   Instagram      │   │  │
│   │  │ API       │  │ API      │  │ API      │  │   Graph API      │   │  │
│   │  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘   │  │
│   │  ┌──────────┐  ┌──────────┐  ┌──────────┐                        │  │
│   │  │ Stripe   │  │ Upstash  │  │ QStash   │                        │  │
│   │  │ SDK      │  │ Redis    │  │ Scheduler│                        │  │
│   │  └──────────┘  └──────────┘  └──────────┘                        │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
        ┌───────────────────┐   ┌───────────────────┐
        │    Supabase       │   │  Social Platform   │
        │  ┌─────────────┐  │   │  APIs              │
        │  │ PostgreSQL   │  │   │  ├── LinkedIn v2   │
        │  │ (Database)   │  │   │  ├── TikTok v2     │
        │  └─────────────┘  │   │  ├── Pinterest v5   │
        │  ┌─────────────┐  │   │  └── Instagram v23  │
        │  │ Storage      │  │   └───────────────────┘
        │  │ (Media)      │  │
        │  └─────────────┘  │
        └───────────────────┘
```

---

## Frontend

### Framework & Routing

- **Framework:** Next.js 16 with App Router
- **Rendering:** Server Components by default, Client Components where interactivity is needed
- **Dev mode:** Turbopack enabled (`next dev --turbopack`)
- **Server Actions:** Enabled with 5MB body size limit

### Route Groups

```
src/app/
├── (marketing)/           # Public routes (no auth required)
│   ├── page.tsx           # Landing page (/)
│   ├── PrivacyPolicy/     # /PrivacyPolicy
│   └── tos/               # /tos
├── (protected)/           # Authenticated routes (sidebar layout)
│   ├── layout.tsx         # SidebarProvider + AppSidebar + SiteHeader
│   ├── create/
│   │   ├── page.tsx       # Post type selection (/create)
│   │   ├── text/page.tsx  # Text post form (/create/text)
│   │   ├── image/page.tsx # Image post form (/create/image)
│   │   └── video/page.tsx # Video post form (/create/video)
│   ├── connections/       # Account management (/connections)
│   ├── scheduled/         # Scheduled posts (/scheduled)
│   ├── posted/            # Content history (/posted)
│   ├── studio/            # Analytics: coming soon (/studio)
│   ├── payment/success/   # Post-checkout confirmation
│   └── userProfile/       # Clerk UserProfile component
├── api/                   # API routes (see Backend section)
├── layout.tsx             # Root layout (Clerk, theme, analytics)
├── not-found.tsx          # Custom 404 page
└── robots.ts              # robots.txt generation
```

### Component Architecture

```
src/components/
├── core/                  # Feature-specific components
│   ├── create/            # Post creation flow
│   │   ├── SocialPostForm.tsx       # Main form (core component)
│   │   ├── upload/                  # ImageUpload, VideoUpload, VideoCoverSelector
│   │   ├── action/                  # handleSocialMediaPost, validateContent, uploadMedia
│   │   └── constants/               # Upload limits, allowed file types
│   ├── accounts/          # Account connection UI
│   │   ├── connectAccountsButton/   # Per-platform connect buttons
│   │   └── pageUi/                  # ConnectedAccountsBadge, SocialAccountBadge
│   ├── scheduled/         # Scheduled posts management
│   │   ├── BatchedPostCard.tsx      # Batch card with inline reschedule form and footer actions
│   │   ├── PostsGrid.tsx           # Grid layout for scheduled posts
│   │   └── MediaPreview.tsx        # Media thumbnail display
│   └── posted/            # Content history display
│       ├── ContentHistoryCard.tsx   # Individual post card
│       └── renderPosts.tsx          # Batch-grouped rendering
├── marketing-page/        # Landing page sections (hero, pricing, footer, etc.)
├── sidebar/               # App navigation (AppSidebar, NavUser, NavCreate, etc.)
├── suspense/              # Skeleton loaders per feature
├── ui/                    # shadcn/ui base components (30+ components)
├── SubscriptionPrompt.tsx # Paywall gate component
└── RateLimitError.tsx     # Rate limit error display
```

### State Management

- No global state library. State is managed via:
  - **React `useState`/`useEffect`** in client components (e.g., `SocialPostForm`)
  - **Server Components** fetch data directly (no client-side data fetching layer)
  - **URL-based routing** for page-level state
- Key state in `SocialPostForm`: selected accounts, per-account content, media file, scheduling date/time, platform-specific options

### Styling

- **Tailwind CSS 4** with PostCSS plugin
- **shadcn/ui** component library (New York variant, zinc base color, CSS variables)
- **oklch** color space for theme variables
- **next-themes** for dark/light mode toggle
- **tw-animate-css** for animations
- **Geist** font family (sans + mono) via `next/font`

### i18n

- `i18n-config.ts` declares locales: `fr` (default), `en`, `es`
- `next-i18next` and `react-i18next` are installed as dependencies
- **Actual translation files and usage:** [NOT FOUND IN CODEBASE]: the app currently renders in English only
- Metadata declares `hreflang` alternates for `en-CA` and `fr-CA` but no translated routes exist

---

## Backend / API Routes

### Route Map

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/social/linkedin/initiate` | Clerk | Generate LinkedIn OAuth URL |
| GET | `/api/social/linkedin/connect` | Clerk | LinkedIn OAuth callback: exchange code, store account |
| POST | `/api/social/linkedin/post` | Internal | Direct post to LinkedIn |
| POST | `/api/social/linkedin/process` | Internal | Process LinkedIn accounts (direct or scheduled) |
| POST | `/api/social/instagram/initiate` | Clerk | Generate Instagram OAuth URL |
| GET | `/api/social/instagram/connect` | Clerk | Instagram OAuth callback: exchange code, store account |
| POST | `/api/social/instagram/post` | Internal | Direct post to Instagram |
| POST | `/api/social/instagram/process` | Internal | Process Instagram accounts |
| POST | `/api/social/tiktok/initiate` | Clerk | Generate TikTok OAuth URL |
| GET | `/api/social/tiktok/connect` | Clerk | TikTok OAuth callback: exchange code, store account |
| POST | `/api/social/tiktok/post` | Internal | Direct post to TikTok |
| POST | `/api/social/tiktok/process` | Internal | Process TikTok accounts |
| POST | `/api/social/pinterest/initiate` | Clerk | Generate Pinterest OAuth URL |
| GET | `/api/social/pinterest/connect` | Clerk | Pinterest OAuth callback: exchange code, store account |
| POST | `/api/social/pinterest/post` | Internal | Direct post to Pinterest |
| POST | `/api/social/pinterest/process` | Internal | Process Pinterest accounts |
| POST | `/api/cron/process-scheduled-posts` | CRON_SECRET_KEY | Process due scheduled posts batch |
| POST | `/api/storage/generate-upload-url` | Clerk + subscription | Generate Supabase signed upload URL |
| POST | `/api/storage/generate-view-url` | None (path validation) | Generate Supabase signed view URL |
| GET | `/api/media` | Query params | Media proxy: redirects to Supabase signed URL |
| POST | `/api/webhooks/clerk` | Svix signature | Clerk user lifecycle events |
| POST | `/api/webhooks/stripe` | Stripe signature | Stripe subscription & invoice events |

### Conventions & Patterns

- Each social platform has a consistent 4-route structure: `initiate`, `connect`, `post`, `process`
- OAuth initiate routes check subscription + account limits before generating auth URLs
- OAuth connect routes return HTML that closes the popup and calls a parent window callback
- Post/process routes are internal-only (called by `handleSocialMediaPost` via `fetch`)
- All platform API integrations live in `src/lib/api/{platform}/`
- Server actions in `src/actions/server/` handle Supabase queries and business logic

### Middleware

```typescript
// src/middleware.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Protected routes:
const isProtectedRoute = createRouteMatcher([
  "/accounts(.*)", "/config(.*)", "/connections(.*)", "/create(.*)",
  "/dashboard(.*)", "/posts(.*)", "/posted(.*)", "/scheduled(.*)",
  "/schedule(.*)", "/studio(.*)", "/userProfile(.*)"
]);

// Also matches: /(api|trpc)(.*)
// Cookies: httpOnly + secure in production
```

---

## Authentication & Authorization

### Provider

**Clerk** (`@clerk/nextjs` v6.33+)

### Auth Flow

```
User → Clerk Sign In/Sign Up
         │
         ▼
   Clerk creates session → JWT stored in cookies
         │
         ▼
   clerkMiddleware validates on every request
         │
         ├── Public routes → pass through
         └── Protected routes → auth required
                │
                ▼
         auth() provides userId in server components/actions
```

### OAuth Flows (Social Platforms)

Each platform follows the same pattern:

```
1. Client clicks "Connect {Platform}"
         │
         ▼
2. POST /api/social/{platform}/initiate
   ├── Verify Clerk auth
   ├── Check active subscription
   ├── Check account limits (plan-based)
   ├── Generate CSRF state token (nanoid, 32 chars)
   ├── Store state in HTTP-only cookie (15-min TTL)
   └── Return OAuth authorization URL
         │
         ▼
3. Client opens OAuth URL in popup window
         │
         ▼
4. User authorizes on platform → redirected to:
   GET /api/social/{platform}/connect?code=...&state=...
   ├── Validate CSRF state against cookie
   ├── Exchange code for access token (+ refresh token)
   ├── Fetch user profile from platform API
   ├── Upsert into social_accounts table
   └── Return HTML: window.opener.onConnectSuccess(); window.close();
```

### OAuth Scopes by Platform

| Platform | Scopes |
|----------|--------|
| LinkedIn | `openid`, `profile`, `email`, `w_member_social` |
| Instagram | `instagram_business_basic`, `instagram_business_content_publish` |
| TikTok | `user.info.basic`, `user.info.profile`, `video.publish`, `video.upload`, `user.info.stats` |
| Pinterest | `boards:read`, `boards:write`, `pins:read`, `pins:write`, `user_accounts:read`, `catalogs:read`, `catalogs:write` |

### Session Management

- Clerk handles session via encrypted cookies
- `httpOnly: true` and `secure: true` in production
- `auth()` server function provides `userId` in all server contexts

### Roles & Permissions

No role-based access control found. Authorization is binary:
1. **Authenticated** (has Clerk session) → can access protected routes
2. **Has active subscription** → can use features (create posts, connect accounts)
3. **Plan-based limits** → account count, storage quota

---

## Database

### ORM / Client

**Supabase JavaScript Client** (`@supabase/supabase-js`): no traditional ORM (no Prisma/Drizzle)

Two clients:
- `supabase.ts`: authenticated client (uses Clerk JWT)
- `adminSupabase.ts`: service role client (bypasses RLS)

### Schema

Derived from `src/lib/types/dbTypes.ts` and usage patterns:

#### `users`

| Column | Type | Notes |
|--------|------|-------|
| id | text (PK) | Clerk user ID |
| email | text | |
| first_name | text | nullable |
| last_name | text | nullable |
| stripe_customer_id | text | nullable |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### `social_accounts`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | auto-generated |
| user_id | text (FK → users) | |
| platform | text | `tiktok`, `instagram`, `pinterest`, `linkedin`, `facebook` |
| account_identifier | text | Platform-specific user ID |
| access_token | text | |
| refresh_token | text | nullable |
| is_availble | boolean | Note: typo in code |
| token_expires_at | timestamptz | |
| extra | jsonb | Platform-specific profile data |
| username | text | |
| avatar_url | text | |
| is_verified | boolean | |
| display_name | text | |
| follower_count | integer | |
| following_count | integer | |
| bio_description | text | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Unique constraint:** `(user_id, platform, account_identifier)`

#### `scheduled_posts`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| user_id | text (FK → users) | |
| social_account_id | uuid (FK → social_accounts) | |
| platform | text | |
| status | text | `scheduled`, `processing`, `posted`, `failed`, `cancelled`, `idle` |
| scheduled_at | timestamptz | |
| posted_at | timestamptz | nullable |
| post_title | text | |
| post_description | text | |
| post_options | jsonb | Platform-specific options |
| media_type | text | `video`, `image`, `text` |
| media_storage_path | text | Supabase storage path |
| error_message | text | nullable |
| batch_id | text | Groups multi-account posts |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### `content_history`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| user_id | text (FK → users) | |
| platform | text | |
| content_id | text | Platform post ID |
| title | text | |
| description | text | |
| media_url | text | |
| extra | jsonb | `{ post_data, post_type, posted_at, board_info, ... }` |
| status | text | |
| media_type | text | |
| social_account_id | uuid | |
| batch_id | text | |
| created_at | timestamptz | |

#### `failed_posts`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| user_id | text | |
| social_account_id | uuid | |
| platform | text | |
| post_title | text | |
| post_description | text | |
| media_type | text | |
| media_storage_path | text | |
| error_message | text | |
| extra_data | jsonb | |
| batch_id | text | |
| created_at | timestamptz | |

#### `stripe_subscriptions`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| user_id | text (FK → users) | |
| stripe_subscription_id | text | |
| stripe_customer_id | text | |
| stripe_price_id | text | |
| plan | text | `starter`, `creator`, `pro` |
| status | text | `active`, `canceled`, `past_due`, `trialing`, `incomplete` |
| start_date | timestamptz | |
| current_period_end | timestamptz | |
| cancel_reason | text | nullable |
| amount | integer | In cents |
| currency | text | |
| is_active | boolean | |
| metadata | jsonb | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### `stripe_invoices` (referenced in webhook)

| Column | Type | Notes |
|--------|------|-------|
| user_id | text | |
| stripe_invoice_id | text | |
| amount_paid | integer | In cents |
| currency | text | |
| status | text | `paid`, `failed` |
| created_at | timestamptz | |

#### `analytics_metrics`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| user_id | text (FK → users) | |
| platform | text | |
| content_id | text | |
| views | bigint | |
| comments | bigint | |
| subscribers | bigint | |
| extra | jsonb | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### Relations

```
users
  ├── 1:N → social_accounts
  ├── 1:N → scheduled_posts
  ├── 1:N → content_history
  ├── 1:N → failed_posts
  ├── 1:N → stripe_subscriptions
  ├── 1:N → stripe_invoices
  └── 1:N → analytics_metrics

social_accounts
  ├── 1:N → scheduled_posts
  └── 1:N → content_history
```

---

## Payments (Stripe)

### Subscription Tiers

| Plan | Monthly | Yearly | Account Limit | Storage | Upload Limits |
|------|---------|--------|---------------|---------|---------------|
| Starter | $9 | $64 (~41% off) | 5 accounts | 5 GB | 8 MB image, 250 MB video |
| Creator | $18 | $129 (~40% off) | 15 accounts | 15 GB | 8 MB image, 250 MB video |
| Pro | $27 | $194 (~40% off) | Unlimited (999) | 45 GB | 8 MB image, 250 MB video |

### Checkout Flow

```
User clicks plan on pricing page
         │
         ▼
createCheckOutSession() server action
  ├── Rate limit check (15 req/min)
  ├── Verify Clerk auth
  ├── Look up user's stripe_customer_id from Supabase
  ├── Create Stripe Checkout Session
  │   ├── mode: "subscription"
  │   ├── success_url: /payment/success
  │   └── cancel_url: /
  └── Return checkout URL
         │
         ▼
User completes payment on Stripe
         │
         ▼
Stripe sends webhook → /api/webhooks/stripe
  ├── customer.subscription.created → insert stripe_subscriptions
  ├── customer.subscription.updated → update stripe_subscriptions
  ├── customer.subscription.deleted → set status "cancelled"
  ├── invoice.payment_succeeded → insert stripe_invoices
  └── invoice.payment_failed → insert stripe_invoices
```

### Customer Portal

- Accessed via sidebar user dropdown ("Billing")
- `createCustomerPortal()` action (rate limited: 20 req/min)
- Redirects to Stripe-hosted portal for subscription management
- Return URL: `/create`

### Webhook Events Handled

| Event | Action |
|-------|--------|
| `customer.subscription.created` | Insert new subscription record |
| `customer.subscription.updated` | Update subscription status/dates/amount |
| `customer.subscription.deleted` | Mark subscription as `cancelled` |
| `invoice.payment_succeeded` | Record successful payment |
| `invoice.payment_failed` | Record failed payment |

---

## Social Media Integrations

### LinkedIn

| Aspect | Detail |
|--------|--------|
| API Version | v2 (Rest.li 2.0.0) |
| OAuth Scopes | `openid`, `profile`, `email`, `w_member_social` |
| Token Refresh | Yes (refresh_token grant) |
| Content Types | Text, Image, Video, Article/Link |
| Post Endpoint | `POST /v2/ugcPosts` |
| Media Upload | Register upload → PUT image / POST video to upload URL → attach to post |
| Media Source | Buffer (downloaded from Supabase, uploaded directly) |
| Special Features | Link/article posts, visibility control |

### TikTok

| Aspect | Detail |
|--------|--------|
| API Version | v2 |
| OAuth Scopes | `user.info.basic`, `user.info.profile`, `video.publish`, `video.upload`, `user.info.stats` |
| Token Refresh | Yes (refresh_token grant) |
| Content Types | Image (photo post), Video |
| Image Endpoint | `POST /v2/post/publish/content/init/` |
| Video Endpoint | `POST /v2/post/publish/video/init/` |
| Media Source | `PULL_FROM_URL` (platform fetches from provided URL) |
| Special Features | Privacy level, disable comment/duet/stitch, video cover timestamp, auto_add_music |
| Dev/Prod Keys | Separate credentials for development vs production |

### Pinterest

| Aspect | Detail |
|--------|--------|
| API Version | v5 |
| OAuth Scopes | `boards:read`, `boards:write`, `pins:read`, `pins:write`, `user_accounts:read`, `catalogs:read`, `catalogs:write` |
| Token Refresh | Yes (refresh_token, 30-day default) |
| Content Types | Image pin, Video pin |
| Pin Creation | `POST /v5/pins` |
| Image Upload | Direct URL reference (`source_type: "image_url"`) |
| Video Upload | Register media → Upload FormData to S3 → Poll status → Create pin with `video_id` |
| Video Processing | Max 40s timeout, 1s poll interval |
| Special Features | Board selection, board creation, link URL, cover image key frame time |
| Auth Method | Basic Auth (base64 `client_id:client_secret`) for token exchange |

### Instagram

| Aspect | Detail |
|--------|--------|
| API Version | Graph API v23.0 |
| OAuth Scopes | `instagram_business_basic`, `instagram_business_content_publish` |
| Token Refresh | Long-lived token refresh (60-day TTL, no refresh_token) |
| Content Types | Image, Video (Reel), Carousel |
| Post Process | Create container → Poll status (max 3 attempts, 15s apart) → Publish → Get shortcode |
| Container Statuses | `EXPIRED`, `ERROR`, `FINISHED`, `IN_PROGRESS`, `PUBLISHED` |
| Carousel | Up to 10 items |
| Special Features | Alt text for images, share_to_feed for Reels |
| Media Source | Public HTTPS URL (platform fetches) |

### Facebook

**Status:** Stub file only (`src/lib/api/facebook/facebook.ts`). No implementation.

### Twitter/X

**Status:** Stub file only (`src/lib/api/twitter/twitter.ts`). No implementation.

---

## Media Management

### Upload Pipeline

```
User selects file in SocialPostForm
         │
         ▼
Client-side validation
  ├── File type check (JPEG, PNG for images; MP4, MOV for videos)
  ├── File size check (8 MB images, 250 MB videos per plan)
  └── For video: extract thumbnail at selected timestamp
         │
         ▼
POST /api/storage/generate-upload-url
  ├── Verify Clerk auth + active subscription
  ├── For scheduled posts: check storage quota
  ├── Generate UUID-based filename: {userId}/{uuid}.{ext}
  ├── Verify/create Supabase bucket
  └── Return signed upload URL + path + token
         │
         ▼
Client uploads file directly to Supabase Storage
  (using signed URL, bypassing server)
         │
         ▼
On post/schedule: media path stored in DB
  ├── Direct post: platform fetches from signed URL (TikTok, Instagram)
  │                or server downloads + re-uploads (LinkedIn, Pinterest)
  └── Scheduled post: path stored, processed later by cron
```

### Supported Formats

| Type | Allowed MIME Types |
|------|-------------------|
| Image | `image/jpeg`, `image/png` |
| Video | `video/mp4`, `video/mov` |

### Storage

- **Provider:** Supabase Storage
- **Bucket:** `scheduled-videos` (used for all media, not just videos)
- **Path format:** `{userId}/{uuid}.{extension}`
- **Access:** Signed URLs with configurable expiration
- **Security:** Path validation prevents directory traversal (`..`, `//`, leading `/`)
- **Quota:** Enforced per plan (5 GB / 15 GB / 45 GB)

### Media Proxy

`GET /api/media?file={path}&user={userId}`: validates path, generates 10-minute signed URL, returns 302 redirect.

---

## Security

### Rate Limiting

Uses `@upstash/ratelimit` with sliding window algorithm over Upstash Redis.

| Operation | Limit | Window | Identifier |
|-----------|-------|--------|------------|
| `fetchSocialAccounts` | 30 | 1 min | userId |
| `getPinterestBoards` | 15 | 1 min | userId |
| `stripeCheckOutSession` | 15 | 1 min | userId |
| `createCustomerPortal` | 20 | 1 min | userId |
| `getScheduledPosts` | 60 | 1 min | userId |
| `directPostLinkedIn` | 25 | 1 min | userId |
| Social post operations | varies | varies | userId or IP |

Cron jobs bypass rate limiting via `CRON_SECRET_KEY`.

### Input Validation

- **Zod** available (installed) for schema validation
- **Media paths:** sanitized against directory traversal
- **OAuth state:** CSRF tokens validated via HTTP-only cookies
- **File uploads:** type and size validated client-side and server-side

### Webhook Security

| Webhook | Verification |
|---------|-------------|
| Clerk | Svix signature verification (`svix` library) |
| Stripe | `stripe.webhooks.constructEvent()` with signing secret |

### CORS / CSRF

- CSRF protection on OAuth flows via state parameter in HTTP-only, secure cookies (15-min expiry)
- No custom CORS configuration found: relies on Next.js defaults
- Middleware applies Clerk auth to all `/(api|trpc)(.*)` routes

### Secrets Management

- Environment variables for all secrets (never hardcoded)
- Separate dev/prod webhook secrets for Clerk and Stripe
- Separate dev/prod API credentials for TikTok
- `server-only` package used to prevent server code from leaking to client bundles

---

## Deployment

### Vercel Configuration

```json
// vercel.json
{
  "functions": {
    "src/app/api/direct/**/*.ts": {
      "maxDuration": 60  // 60-second timeout for direct post routes
    }
  }
}
```

### Environment Strategy

- **Development:** Uses `_DEV` suffixed keys for Stripe webhooks, Clerk webhooks, TikTok credentials
- **Production:** Uses standard keys
- Detected via `process.env.NODE_ENV`

### CI/CD

[NOT FOUND IN CODEBASE]: No GitHub Actions, Vercel build hooks, or CI configuration files detected. Likely using Vercel's default Git integration (auto-deploy on push).

### Environments

- **Development:** `bun dev` with Turbopack, Stripe CLI for webhooks, dev API credentials
- **Production:** Deployed on Vercel at `https://sharetopus.com`
- **Staging:** [NOT FOUND IN CODEBASE]

---

## Data Flows

### 1. Sign Up / Login

```
User visits sharetopus.com
         │
         ▼
Clicks "Sign In" → Clerk SignIn component
         │
         ▼
Clerk handles auth (email, OAuth, etc.)
         │
         ▼
Clerk fires webhook → POST /api/webhooks/clerk
  event: "user.created"
         │
         ├── Create Stripe customer (with userId in metadata)
         ├── Insert into Supabase `users` table
         │   { id: clerkUserId, email, first_name, last_name, stripe_customer_id }
         └── Return 200
         │
         ▼
User redirected to /create (protected)
  └── SubscriptionPrompt shown (no active subscription yet)
```

### 2. Connect a Social Account

```
User on /connections clicks "Connect LinkedIn"
         │
         ▼
POST /api/social/linkedin/initiate
  ├── auth() → get userId
  ├── checkActiveSubscription(userId) → verify plan
  ├── checkAccountLimits(userId, planId) → verify not at limit
  ├── state = nanoid(32)
  ├── Set cookie: linkedin_oauth_state = state (httpOnly, 15min)
  └── Return authUrl: https://linkedin.com/oauth/v2/authorization?...
         │
         ▼
Client opens authUrl in popup window
         │
         ▼
User authorizes on LinkedIn → redirect to:
GET /api/social/linkedin/connect?code=ABC&state=XYZ
  ├── Validate state === cookie value
  ├── exchangeLinkedInCode(code) → { access_token, expires_in, refresh_token }
  ├── getLinkedInProfile(access_token) → { sub, name, email, picture }
  ├── Supabase upsert into social_accounts
  │   { user_id, platform: "linkedin", account_identifier: sub,
  │     access_token, refresh_token, token_expires_at, username, avatar_url, ... }
  └── Return HTML: window.opener.onLinkedInConnectSuccess(); window.close();
         │
         ▼
Parent window refreshes connections list
```

### 3. Create and Publish a Post

```
User on /create/image selects accounts & uploads image
         │
         ▼
Client: uploadMedia()
  ├── POST /api/storage/generate-upload-url → signed URL
  ├── PUT to Supabase signed URL → upload file
  └── Return media storage path
         │
         ▼
User clicks "Post Now"
         │
         ▼
handleSocialMediaPost()
  ├── validateContent() → check required fields per platform
  ├── Group selected accounts by platform
  ├── For each platform group, call:
  │   POST /api/social/{platform}/process
  │   Body: { accounts, content, mediaUrl, userId, ... }
  │         │
  │         ▼
  │   process{Platform}Accounts()
  │     ├── For each account (in parallel):
  │     │   ├── ensureValidToken(account) → refresh if needed
  │     │   ├── directPostFor{Platform}Accounts()
  │     │   │   ├── Download media (if LinkedIn/Pinterest)
  │     │   │   ├── postTo{Platform}(accessToken, content, media)
  │     │   │   │   └── Platform-specific API calls
  │     │   │   ├── storeContentHistory() on success
  │     │   │   └── Return result
  │     │   └── Collect success/error per account
  │     └── Return { successCount, errors[] }
  │
  └── Aggregate results → show toast notifications
```

### 4. Schedule a Post

```
User toggles "Schedule" → picks date/time → clicks "Schedule"
         │
         ▼
handleSocialMediaPost() (isScheduled = true)
  ├── Generate batch_id (nanoid)
  ├── Upload media to Supabase Storage
  ├── For each platform group:
  │   POST /api/social/{platform}/process (isScheduled: true)
  │         │
  │         ▼
  │   process{Platform}Accounts()
  │     └── For each account:
  │         schedule{Platform}Accounts()
  │           └── schedulePost() server action
  │               ├── Validate fields
  │               ├── Insert into scheduled_posts
  │               │   { status: "scheduled", batch_id, scheduled_at, ... }
  │               └── Return scheduleId
  │
  └── Posts appear on /scheduled page
         │
         ▼
[At scheduled time]
QStash triggers → POST /api/cron/process-scheduled-posts
  ├── Validate CRON_SECRET_KEY
  ├── Fetch scheduled posts for batch
  ├── Group by platform
  ├── Call handleSocialMediaPost() with post data
  ├── On success: delete from scheduled_posts
  └── On failure: insert into failed_posts
```

### 5. Subscription Payment

```
User clicks plan on pricing page
         │
         ▼
createCheckOutSession(priceId)
  ├── Rate limit check
  ├── Get user's stripe_customer_id from Supabase
  ├── stripe.checkout.sessions.create({
  │     customer: stripe_customer_id,
  │     mode: "subscription",
  │     line_items: [{ price: priceId, quantity: 1 }],
  │     success_url: /payment/success,
  │     cancel_url: /
  │   })
  └── Return checkout URL
         │
         ▼
User completes Stripe Checkout
         │
         ▼
Stripe webhook → POST /api/webhooks/stripe
  event: "customer.subscription.created"
  ├── Look up user by stripe_customer_id
  ├── Insert into stripe_subscriptions
  │   { user_id, plan, status: "active", amount, currency, ... }
  └── Return 200
         │
         ▼
event: "invoice.payment_succeeded"
  ├── Insert into stripe_invoices
  └── Return 200
         │
         ▼
User redirected to /payment/success
  └── Confetti animation + "Continue" → /create
         │
         ▼
All protected features now unlocked (subscription check passes)
```
