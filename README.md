# Sharetopus

**Post once, share everywhere.** A multi-platform social media management tool for creators and small teams.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss)
![Stripe](https://img.shields.io/badge/Stripe-Payments-635BFF?logo=stripe)
![Vercel](https://img.shields.io/badge/Deployed_on-Vercel-000?logo=vercel)

---

## Description

Sharetopus is a web application that lets users create content once and publish or schedule it across multiple social media platforms simultaneously. It supports text, image, and video posts with platform-specific options (TikTok privacy settings, Pinterest board selection, LinkedIn visibility, etc.). Users manage their connected social accounts, schedule posts for later, and track their content history — all from a single dashboard behind a subscription paywall.

---

## Features

### Content Creation & Publishing
- Create and publish text, image, and video posts from a single form
- Post simultaneously to multiple accounts across different platforms
- Per-account content customization (title, description, link)
- Platform-specific options: TikTok privacy/duet/stitch/comment toggles, Pinterest board selection & link, LinkedIn visibility
- Drag-and-drop media upload with file type and size validation
- Video cover/thumbnail selector with timestamp picker
- Batch posting with unique `batch_id` tracking

### Scheduling
- Schedule posts for a future date and time
- Batch scheduling across multiple accounts
- Reschedule, cancel, resume, and delete scheduled posts
- Cron-based processing of scheduled posts via QStash
- Grouped view of scheduled posts by batch

### Social Account Management
- OAuth-based account connection for each platform
- Account limits enforced per subscription tier
- Automatic token refresh with 5-minute expiration buffer
- Account disconnect functionality
- Display of profile info (avatar, username, follower count)

### Payments & Subscriptions
- Three subscription tiers: Starter ($9/mo), Creator ($18/mo), Pro ($27/mo)
- Monthly and yearly billing (with yearly discount)
- Stripe Checkout integration
- Stripe Customer Portal for billing management
- Subscription gating on all protected features
- Webhook-driven subscription lifecycle management

### Content History
- Track all published posts with status, platform, and media info
- Failed post tracking with error messages
- Batch-grouped content history view

### Marketing & SEO
- Public landing page with hero, features, pricing, testimonials, and comparisons
- Privacy Policy and Terms of Service pages
- Sitemap generation via `next-sitemap`
- `robots.ts` configuration
- Open Graph / SEO metadata with `hreflang` alternates (en-CA, fr-CA)

### Security
- Rate limiting via Upstash Redis (sliding window) on key actions
- CSRF protection on OAuth flows (state tokens in HTTP-only cookies)
- Webhook signature verification (Svix for Clerk, Stripe SDK)
- Path traversal prevention on media proxy routes
- Cron job authentication via secret key
- Clerk middleware protecting all app routes

---

## Tech Stack

| Category | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5.9 |
| UI Library | React 19 |
| Styling | Tailwind CSS 4, shadcn/ui (New York style), tw-animate-css |
| Icons | Lucide React, Tabler Icons |
| Auth | Clerk (`@clerk/nextjs`) |
| Database | Supabase (PostgreSQL + Storage) |
| Payments | Stripe (subscriptions, checkout, webhooks) |
| Caching / Rate Limiting | Upstash Redis + `@upstash/ratelimit` |
| Task Scheduling | Upstash QStash |
| File Storage | Supabase Storage (bucket: `scheduled-videos`) |
| Charts | Recharts |
| Drag & Drop | dnd-kit |
| Forms / Validation | Zod |
| Date Utilities | date-fns |
| HTTP Client | Axios, node-fetch |
| Notifications | Sonner (toast) |
| Theme | next-themes (light/dark mode) |
| Analytics | Vercel Analytics + Speed Insights |
| Webhook Verification | Svix |
| Deployment | Vercel |
| Package Manager | Bun |

---

## Supported Social Platforms

| Platform | OAuth | Text | Image | Video | Status |
|---|---|---|---|---|---|
| **LinkedIn** | OpenID Connect (`w_member_social`) | Yes | Yes | Yes | Active |
| **TikTok** | OAuth 2.0 (`video.publish`, `video.upload`) | No | Yes | Yes | Active |
| **Pinterest** | OAuth 2.0 (`pins:write`, `boards:read/write`) | No | Yes | Yes | Active |
| **Instagram** | OAuth (`instagram_business_content_publish`) | No | Yes | Yes (Reels) | Active |
| **Facebook** | — | — | — | — | Stub (not implemented) |
| **Twitter/X** | — | — | — | — | Stub (not implemented) |

---

## Getting Started

### Prerequisites
- [Bun](https://bun.sh/) (recommended) or Node.js
- Stripe CLI (for local webhook testing)
- Accounts: Clerk, Supabase, Stripe, Upstash, and social platform developer apps

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd sharetopus

# Install dependencies
bun install

# Copy environment variables
cp .env.example .env
# Fill in all required values (see Environment Variables section)
```

### Development

```bash
# Start the dev server (uses Turbopack)
bun dev

# In a separate terminal, forward Stripe webhooks locally
stripe listen --forward-to http://localhost:3000/api/webhooks/stripe
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build & Production

```bash
bun run build
bun start
```

---

## Environment Variables

All variables referenced in the codebase:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_SERVICE_KEY` | Supabase anon/service key (public) |
| `SUPABASE_SERVICE_ROLE` | Supabase service role key (bypasses RLS) |
| `STRIPE_SECRET_KEY` | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (production) |
| `STRIPE_WEBHOOK_SECRET_DEV` | Stripe webhook signing secret (development) |
| `FRONTEND_URL` | App base URL (e.g., `https://sharetopus.com`) |
| `CLERK_WEBHOOK_SECRET` | Clerk webhook signing secret (production) |
| `CLERK_WEBHOOK_SECRET_DEV` | Clerk webhook signing secret (development) |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis authentication token |
| `QSTASH_TOKEN` | Upstash QStash API token |
| `CRON_SECRET_KEY` | Secret for authenticating cron job requests |
| `LINKEDIN_CLIENT_ID` | LinkedIn OAuth app client ID |
| `LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth app client secret |
| `LINKEDIN_REDIRECT_URL` | LinkedIn OAuth callback URL |
| `INSTAGRAM_CLIENT_ID` | Instagram/Facebook app client ID |
| `INSTAGRAM_CLIENT_SECRET` | Instagram/Facebook app client secret |
| `INSTAGRAM_REDIRECT_URL` | Instagram OAuth callback URL |
| `PINTEREST_CLIENT_ID` | Pinterest OAuth app client ID |
| `PINTEREST_CLIENT_SECRET` | Pinterest OAuth app client secret |
| `PINTEREST_REDIRECT_URL` | Pinterest OAuth callback URL |
| `TIKTOK_CLIENT_KEY` | TikTok app client key (production) |
| `TIKTOK_CLIENT_SECRET` | TikTok app secret (production) |
| `TIKTOK_CLIENT_KEY_DEV` | TikTok app client key (development) |
| `TIKTOK_CLIENT_SECRET_DEV` | TikTok app secret (development) |
| `TIKTOK_REDIRECT_URL` | TikTok OAuth callback URL |
| `NODE_ENV` | Environment mode (`development` / `production`) |

Additionally, Clerk requires its own env vars (managed by `@clerk/nextjs`): `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, etc.

---

## Project Structure

```
sharetopus/
├── public/                    # Static assets (logos, platform icons, demo images)
├── src/
│   ├── actions/               # Server actions & API client setup
│   │   ├── api/               # Supabase, Upstash, QStash client initialization
│   │   ├── client/            # Client-side actions (signed URLs)
│   │   └── server/            # Server-side actions (auth, stripe, scheduling, rate limiting)
│   ├── app/
│   │   ├── (marketing)/       # Public pages (landing, privacy, ToS)
│   │   ├── (protected)/       # Authenticated pages (create, connections, scheduled, posted, studio)
│   │   └── api/               # API routes (social OAuth, webhooks, cron, storage, media)
│   ├── components/
│   │   ├── core/              # Feature components (create, posted, scheduled, accounts)
│   │   ├── icons/             # Platform icon components
│   │   ├── marketing-page/    # Landing page sections
│   │   ├── sidebar/           # App navigation sidebar
│   │   ├── suspense/          # Loading skeleton components
│   │   └── ui/                # shadcn/ui base components
│   ├── hooks/                 # Custom React hooks
│   └── lib/
│       ├── api/               # Social platform API integrations (Instagram, LinkedIn, Pinterest, TikTok)
│       └── types/             # TypeScript types (DB schema, plans, profiles)
├── i18n-config.ts             # i18n locale configuration (fr, en, es)
├── next.config.ts             # Next.js config (image domains, server action limits)
├── vercel.json                # Vercel deployment config (API function timeout: 60s)
└── package.json               # Dependencies and scripts
```

---

## Scripts

| Script | Command | Description |
|---|---|---|
| `dev` | `next dev --turbopack` | Start development server with Turbopack |
| `build` | `next build` | Build for production |
| `start` | `next start` | Start production server |
| `lint` | `next lint` | Run ESLint |

---

## License

[TO VERIFY]
