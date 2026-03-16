# 🐙 Sharetopus: Post Once, Share Everywhere

![Next.js](https://img.shields.io/badge/Next.js-16.1.6-black?logo=next.js)
![React](https://img.shields.io/badge/React-19.2-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.1-06B6D4?logo=tailwindcss)
![Clerk](https://img.shields.io/badge/Auth-Clerk_v7-6C47FF?logo=clerk)
![Stripe](https://img.shields.io/badge/Payments-Stripe-635BFF?logo=stripe)
![Supabase](https://img.shields.io/badge/Database-Supabase-3FCF8E?logo=supabase)
![Vercel](https://img.shields.io/badge/Deployed-Vercel-000000?logo=vercel)
![Status](https://img.shields.io/badge/Status-Production-brightgreen)

---

## Description

**Sharetopus** is a SaaS multi-platform social media publishing tool that lets users create, customize, and schedule content across LinkedIn, TikTok, Pinterest, and Instagram from a single dashboard. It targets solo creators, small teams, and social media managers who want to stop wasting hours copying and pasting the same content across platforms. The app has been in production at [sharetopus.com](https://sharetopus.com) for over a year with real users and active Stripe payments. Built with Next.js 16 App Router, it uses Clerk for authentication, Supabase (PostgreSQL) for data persistence, Stripe for subscription billing, and Upstash Redis/QStash for rate limiting and scheduled job processing.

---

## Live Demo

**Production URL:** [https://sharetopus.com](https://sharetopus.com)

![Landing Page Screenshot](./public/landing.png)
![Dashboard Screenshot](./public/dashboard.png)
![Create Post Screenshot](./public/create-post.png)

---

## AI-Powered Testing with TestSprite

Sharetopus uses [TestSprite](https://www.testsprite.com) for automated AI-driven end-to-end testing. TestSprite generates Playwright-based test cases from the codebase, executes them against the running application, and produces visual test recordings for every run.

### Test Results Summary

| Metric | Value |
|--------|-------|
| **Total frontend tests** | 19 |
| **Pass rate** | 86.67% (13/15 core tests passing) |
| **Coverage areas** | Landing page, authentication, content creation, social connections, scheduled post management, subscription paywall |
| **Test framework** | Playwright (Python, headless Chromium) |

### Bugs Found and Fixed

TestSprite's automated testing identified two bugs in the application:

**1. Missing middleware protection on `/connections` and `/userProfile` routes**

The Clerk middleware's `createRouteMatcher` did not include `/connections(.*)` or `/userProfile(.*)` in the protected route list. This meant unauthenticated requests could reach these page components directly, where `auth()` returned `null` and the subscription check incorrectly displayed a "No active subscription" prompt instead of redirecting to sign-in.

- **File:** `src/middleware.ts`
- **Fix:** Added `/connections(.*)` and `/userProfile(.*)` to the protected route matcher
- **Severity:** High: unauthenticated users could access protected page components

**2. Reschedule button inaccessible in scheduled post dialog**

The Reschedule button in the batch detail dialog used a dual-dialog pattern: clicking it closed the main dialog and opened a separate reschedule dialog. This caused two issues: the button was placed in `AlertDialogHeader` (non-standard for action buttons), and the dialog-switching pattern made the Reschedule control unreachable for automated interaction. The Cancel and Delete buttons worked correctly because they were in the expected footer position.

- **File:** `src/components/core/scheduled/BatchedPostCard.tsx`
- **Fix:** Replaced the separate reschedule dialog with an inline form that renders within the main dialog. Moved all action buttons (Reschedule, Cancel, Resume, Delete) to `AlertDialogFooter` and added `aria-label` attributes for accessibility.
- **Severity:** High: the reschedule workflow was functionally broken for automated testing and had accessibility gaps

### Verification

After applying both fixes, TestSprite re-ran the full test suite:

| Test | Before Fix | After Fix |
|------|:----------:|:---------:|
| TC015: Connections page shows connected accounts | Failed | Passed |
| TC016: Instagram connection UI disabled | Failed | Passed |
| TC018: Reschedule a batch to a future date/time | Failed | Passed |

All previously passing tests continued to pass. Overall pass rate improved from 80% (12/15) to 86.67% (13/15).

### Test Artifacts

```
testsprite_tests/
├── TC001_Landing_page_loads_and_key_marketing_sections_are_visible.py
├── TC002_Pricing_section_is_reachable_and_displays_plan_information.py
├── TC003_Toggle_between_monthly_and_yearly_pricing_updates_the_pricing_view.py
├── TC004_Privacy_Policy_link_navigates_to_the_static_Privacy_Policy_page.py
├── TC005_Terms_of_Service_link_navigates_to_the_static_Terms_of_Service_page.py
├── TC006_Successful_sign_in_returns_user_to_create_and_shows_post_type_hub.py
├── TC007_Invalid_password_shows_Clerk_authentication_error.py
├── TC008_Authenticated_user_can_access_another_protected_route_scheduled.py
├── TC011_Text_post_Post_Now_to_LinkedIn_shows_success_toast.py
├── TC013_Text_post_Cannot_submit_without_selecting_an_account.py
├── TC015_Connections_page_shows_connected_accounts_and_plan_limit_counters.py
├── TC016_Instagram_connection_UI_is_not_available_disabled_or_missing.py
├── TC017_View_Scheduled_page_shows_grouped_batches_with_visible_status_and_platform_indicators.py
├── TC018_Reschedule_a_batch_to_a_valid_future_datetime_updates_the_scheduled_date_shown_in_list.py
├── TC019_Cancel_a_scheduled_batch_changes_its_status_to_cancelled.py
├── TC048_Dark_mode_toggle_works_on_landing_page.py
├── TC049_Rate_limit_error_displays_correctly_when_too_many_requests.py
├── TC050_Subscription_paywall_blocks_features_for_users_without_active_plan.py
├── TC051_Media_upload_rejects_files_over_8MB_for_images.py
├── standard_prd.json                          # Standardized PRD generated from codebase
├── testsprite_frontend_test_plan.json          # Full test plan with steps and assertions
├── testsprite-mcp-test-report.md               # Formatted test report
└── tmp/
    ├── code_summary.yaml                       # Codebase analysis (routes, features, tech stack)
    ├── config.json                             # TestSprite project configuration
    ├── raw_report.md                           # Raw test execution results
    └── test_results.json                       # Detailed results with test code and recordings
```

Each test case includes a link to its visual recording on the [TestSprite dashboard](https://www.testsprite.com), showing the full browser interaction for review.

---

## Routes & Navigation Map

> **CRITICAL for TestSprite:** These are the **exact** paths that exist in the application. Any path NOT listed here will result in a custom 404 page ("Oops! Page not found").

### Public Routes (No Authentication Required)

| Path | Description | Key Components | Actions |
|------|-------------|----------------|---------|
| `/` | Marketing landing page | Navbar, Hero, Testimonials, ProblemsSection, FeaturesSection, StatsSection, HeroVisuals, AlternativesSection, Pricing, Footer | Browse sections, toggle monthly/yearly pricing, click "Start Now" CTA (navigates to `/create`, triggers Clerk auth if not signed in) |
| `/PrivacyPolicy` | Privacy policy page (note: capital P) | Static legal content, Navbar, Footer | Read policy. Contact: sharetopusInc@gmail.com |
| `/tos` | Terms of service page | Static legal content, Navbar, Footer | Read terms. Applicable law: Canada. 24h refund policy. |

### Authentication

Sharetopus uses **Clerk** for authentication. There are **NO dedicated sign-in or sign-up page routes** (no `/sign-in`, no `/sign-up`, no `/login`).

| Aspect | Detail |
|--------|--------|
| **How auth triggers** | When an unauthenticated user navigates to any protected route (e.g., `/create`), the Clerk middleware intercepts and displays Clerk's hosted authentication UI (modal/redirect). |
| **Internal auth handler** | `/api/auth/[clerk]` renders `<SignIn />` from `@clerk/nextjs`: this is Clerk's internal catch-all, **NOT a user-navigable page**. |
| **Supported login methods** | Configured in Clerk dashboard `[TO VERIFY exact providers]`: typically Email/Password, Google OAuth, GitHub OAuth. |
| **Session management** | Clerk JWT tokens. Server components use `auth()` and `currentUser()` from `@clerk/nextjs/server`. |
| **User sync** | On every protected page load, `ensureUserExists()` syncs the Clerk user to Supabase and creates a Stripe customer if missing. |

### Protected Routes (Authentication Required)

All routes below require Clerk authentication. The middleware (`src/middleware.ts`) protects these patterns: `/accounts(.*)`, `/config(.*)`, `/connections(.*)`, `/create(.*)`, `/dashboard(.*)`, `/posts(.*)`, `/posted(.*)`, `/scheduled(.*)`, `/schedule(.*)`, `/studio(.*)`, `/userProfile(.*)`.

Additionally, most features require an **active subscription**. Pages that require a subscription show a `SubscriptionPrompt` component instead of the normal content if the user has no active plan.

| Path | Auth | Subscription Required | Description | Key Components | Actions |
|------|------|:---------------------:|-------------|----------------|---------|
| `/create` | Yes | Yes (paywall) | Post type selection hub | Three clickable cards: Text Post, Image Post, Video Post. Each shows supported platform icons. Link to `/connections` at bottom. | Click a card → navigates to `/create/text`, `/create/image`, or `/create/video` |
| `/create/text` | Yes | Yes | Text post creation form | `SocialPostForm` (postType="text") | Select LinkedIn accounts, write description (3000 char limit), customize per-account content, post immediately OR schedule for later |
| `/create/image` | Yes | Yes | Image post creation form | `SocialPostForm` (postType="image") | Select accounts (LinkedIn, Pinterest, TikTok, Instagram), upload JPEG/PNG image (max 8MB), write title + caption, set platform-specific options, post immediately OR schedule |
| `/create/video` | Yes | Yes | Video post creation form | `SocialPostForm` (postType="video") | Select accounts (LinkedIn, Pinterest, TikTok, Instagram), upload MP4/MOV video (max 250MB), select cover thumbnail via timestamp, write title + caption, set platform-specific options, post immediately OR schedule |
| `/connections` | Yes | Yes (paywall) | Social account management | Connect buttons per platform (TikTok, Pinterest, LinkedIn), `ConnectedAccountsBadge` cards, `ConnectionLimitModal`, account count display | Connect accounts via OAuth popup, disconnect accounts, view usage vs. limit |
| `/scheduled` | Yes | No | Scheduled posts management | `PostsGrid`, `BatchedPostCard` with status badges | View batches grouped by date, reschedule (inline date+time picker), cancel, resume cancelled, delete (confirmation dialog) |
| `/posted` | Yes | No | Published content history | `RenderPosts`, `ContentHistoryCard` | View content grouped by batch, click batch to see per-platform status + external "View post" links |
| `/studio` | Yes | No | Analytics dashboard | `ComingSoon` component | **No actions: displays "COMING SOON" only** |
| `/userProfile` | Yes | No | User account settings | Clerk `<UserProfile />` component (catch-all: `/userProfile/[[...rest]]`) | Manage Clerk account settings (password, email, connected accounts, etc.) |
| `/payment/success` | Yes | No | Post-checkout confirmation | Confetti animation (150 particles, 6 colors, 6s), success message, "Continue" button | Click "Continue" → navigates to `/create` |

### How to Access Key Features

| Action | Navigation Path |
|--------|----------------|
| Create a post | Sidebar → "New Post" → `/create` → choose type |
| Connect a social account | Sidebar → "Accounts" → `/connections` → click platform connect button |
| View scheduled posts | Sidebar → "Scheduled" → `/scheduled` |
| View posted content | Sidebar → "Posted" → `/posted` |
| Access user profile | Sidebar footer → user avatar dropdown → "Account" → `/userProfile` |
| Manage billing | Sidebar footer → user avatar dropdown → "Billing" → Stripe Customer Portal (external) |
| Subscribe to a plan | Landing page pricing section → click plan button → Stripe Checkout (external) |
| Log out | Sidebar footer → user avatar dropdown → "Log out" |

### API Routes

| Method | Path | Auth Mechanism | Description |
|--------|------|----------------|-------------|
| **Social OAuth - Initiate** |
| POST | `/api/social/linkedin/initiate` | Clerk auth + active subscription + account limits | Generate LinkedIn OAuth URL, set CSRF state cookie |
| POST | `/api/social/tiktok/initiate` | Clerk auth + active subscription + account limits | Generate TikTok OAuth URL, set CSRF state cookie |
| POST | `/api/social/pinterest/initiate` | Clerk auth + active subscription + account limits | Generate Pinterest OAuth URL, set CSRF state cookie |
| POST | `/api/social/instagram/initiate` | Clerk auth + active subscription + account limits | Generate Instagram OAuth URL, set CSRF state cookie |
| **Social OAuth - Callback** |
| GET | `/api/social/linkedin/connect` | Clerk auth + CSRF state cookie | Exchange LinkedIn auth code for tokens, store account |
| GET | `/api/social/tiktok/connect` | Clerk auth + CSRF state cookie | Exchange TikTok auth code for tokens, store account |
| GET | `/api/social/pinterest/connect` | Clerk auth + CSRF state cookie | Exchange Pinterest auth code for tokens, store account |
| GET | `/api/social/instagram/connect` | Clerk auth + CSRF state cookie | Exchange Instagram auth code for tokens, store account |
| **Social Posting** |
| POST | `/api/social/linkedin/post` | Internal (no user auth) | Post content to LinkedIn via API |
| POST | `/api/social/tiktok/post` | Internal (no user auth) | Post content to TikTok via API |
| POST | `/api/social/pinterest/post` | Internal (no user auth) | Post content to Pinterest via API |
| POST | `/api/social/instagram/post` | Internal (no user auth) | Post content to Instagram via API |
| **Social Account Processing** |
| POST | `/api/social/linkedin/process` | Internal (no user auth) | Refresh/sync LinkedIn account data |
| POST | `/api/social/tiktok/process` | Internal (no user auth) | Refresh/sync TikTok account data |
| POST | `/api/social/pinterest/process` | Internal (no user auth) | Refresh/sync Pinterest account data |
| POST | `/api/social/instagram/process` | Internal (no user auth) | Refresh/sync Instagram account data |
| **Storage** |
| POST | `/api/storage/generate-upload-url` | Clerk auth + active subscription + storage limit check | Generate Supabase signed upload URL |
| POST | `/api/storage/generate-view-url` | None (path validated) | Generate Supabase signed view URL (10-min expiry) |
| GET | `/api/media` | None (query params: `file`, `user`) | Proxy media retrieval via signed URL redirect (302) |
| **Webhooks** |
| POST | `/api/webhooks/stripe` | Stripe signature verification | Handle `customer.subscription.*` and `invoice.payment_*` events |
| POST | `/api/webhooks/clerk` | Svix signature verification | Handle `user.created`, `user.updated`, `user.deleted` events |
| **Cron** |
| POST | `/api/cron/process-scheduled-posts` | Bearer token (`CRON_SECRET_KEY`) | Process scheduled post batches: publish and move to content_history |

---

## Authentication System

| Aspect | Detail |
|--------|--------|
| **Provider** | [Clerk](https://clerk.com) (`@clerk/nextjs` v7) |
| **Auth method** | Clerk-managed modal/redirect: **no dedicated `/sign-in` or `/sign-up` routes exist** |
| **Login methods** | Configured in Clerk dashboard `[TO VERIFY]`: typically Email/Password + Google + GitHub |
| **Session management** | Clerk JWT tokens; server-side via `auth()` and `currentUser()` |
| **Middleware file** | `src/middleware.ts`: uses `clerkMiddleware()` with `createRouteMatcher()` |
| **Protected route patterns** | `/accounts(.*)`, `/config(.*)`, `/connections(.*)`, `/create(.*)`, `/dashboard(.*)`, `/posts(.*)`, `/posted(.*)`, `/scheduled(.*)`, `/schedule(.*)`, `/studio(.*)`, `/userProfile(.*)` |
| **User sync (fallback)** | `ensureUserExists()` called on every protected page load: syncs Clerk user → Supabase, creates Stripe customer if missing, syncs subscription/invoice data from Stripe |
| **User lifecycle webhook** | `/api/webhooks/clerk` with Svix verification handles `user.created` (create Supabase user + Stripe customer), `user.updated` (sync profile), `user.deleted` (delete user + Stripe customer + storage) |
| **User profile page** | Clerk's `<UserProfile />` component at `/userProfile` |
| **Root provider** | `<ClerkProvider>` wraps entire app in `src/app/layout.tsx` |

---

## Features (Detailed)

### Content Creation

| Feature | Details |
|---------|---------|
| **Text posts** | LinkedIn only. Fields: description (3000 char limit). Per-account customization supported. |
| **Image posts** | LinkedIn, Pinterest, TikTok, Instagram. Upload JPEG/PNG (max 8MB). PNG auto-converted to JPEG for Instagram. Per-account caption customization. |
| **Video posts** | LinkedIn, Pinterest, TikTok, Instagram. Upload MP4/MOV (max 250MB). Cover thumbnail via timestamp selector. Per-account caption customization. |
| **Multi-account posting** | Select multiple accounts across platforms, post simultaneously. Content customizable per account via toggle. |
| **Character limits** | LinkedIn: 3000, Pinterest: 500, TikTok: 2200, Instagram: 2200, Twitter: 280 (stub), Facebook: 63206 (stub) |
| **Platform-specific options** | TikTok: privacy level (SELF_ONLY default), disable comments/duets/stitches. Pinterest: board selection (required), new board creation, link URL. LinkedIn: visibility (PUBLIC default). Instagram: alt text (1000 char). |
| **Form validation** | Auth check, at least one account selected, media required for image/video, file format/size validation, future date for scheduling, Pinterest board required for pin posts. |
| **Access** | `/create` → choose type → `/create/text`, `/create/image`, or `/create/video` |
| **Prerequisites** | Active subscription + at least one connected social account of a supported platform |

### Scheduling

| Feature | Details |
|---------|---------|
| **Schedule a post** | Toggle "Schedule" in the create form. Select date (min: tomorrow) + time (HH:MM). Posts stored in `scheduled_posts` with `batch_id`. |
| **View scheduled** | `/scheduled` page shows batches with date, status badge, media type, platform avatars. |
| **Reschedule** | Click batch → Reschedule → inline date/time picker within the batch dialog. |
| **Cancel** | Sets batch status to `cancelled`. Reversible. |
| **Resume** | Reactivates cancelled batch back to `scheduled`. |
| **Delete** | Permanent removal. Requires confirmation dialog. |
| **Processing** | QStash triggers `POST /api/cron/process-scheduled-posts` at scheduled time with `batch_id` + `user_id`. Posts published and moved to `content_history`. Failures stored in `failed_posts`. |

### Social Account Management

| Feature | Details |
|---------|---------|
| **Connect** | `/connections` page → click platform connect button → OAuth popup → account stored. |
| **Disconnect** | Remove from connections page. |
| **Platforms currently connectable** | TikTok, Pinterest, LinkedIn (Instagram button commented out in UI but backend functional). |
| **Account limits** | Starter: 5, Creator: 15, Pro: 999 (unlimited). `ConnectionLimitModal` shown when limit reached with upgrade CTA. |
| **Default limit (no subscription)** | 0: cannot connect any accounts without a paid plan. |
| **Access** | Sidebar → "Accounts" → `/connections` |
| **Prerequisites** | Active subscription |

### Content History

| Feature | Details |
|---------|---------|
| **View** | `/posted` page shows all published content grouped by batch. |
| **Details** | Click a batch → dialog shows per-platform status and external "View post" links. |
| **Status badges** | Posted, In Progress, Failed, Pending |
| **Access** | Sidebar → "Posted" → `/posted` |

### Payments & Subscriptions

| Feature | Details |
|---------|---------|
| **Checkout** | Stripe Checkout session initiated from pricing section (landing page or in-app `SubscriptionPrompt`). Card-only payment. Promo codes enabled. |
| **Post-checkout** | Redirect to `/payment/success` with confetti animation. |
| **Customer portal** | Sidebar → user dropdown → "Billing" → opens Stripe Customer Portal. Return URL: `/create`. |
| **Subscription check** | `checkActiveSubscription()` verifies user has status `active`, `trialing`, or `past_due`. |
| **No free trial** | System supports `trialing` status from Stripe but no automatic trial creation is configured `[TO VERIFY]`. |
| **Gated features** | Without subscription: cannot create posts, cannot connect accounts. `SubscriptionPrompt` component shown. |

### Marketing Pages

| Feature | Details |
|---------|---------|
| **Landing page `/`** | Hero ("Share Once, Post Everywhere"), 2 testimonials, 4 pain points, expandable features list, stats (3h 4m/week saved, 195,694 posts), competitor comparison, 3-tier pricing, footer with social links. |
| **Pricing section** | Monthly/yearly toggle. Yearly shows ~40% savings badge. Creator plan highlighted as "Best deal" (scale-105). Each plan has "Start Now" CTA. |
| **Privacy Policy `/PrivacyPolicy`** | Data collection, YouTube API compliance, data sharing, children's privacy, GDPR, contact info. |
| **Terms of Service `/tos`** | Usage terms, 24h refund policy, Canadian law, YouTube ToS binding. |
| **Custom 404** | Bear illustration, "Oops! Page not found", "Return to Homepage" button → `/`. |

### Media Management

| Feature | Details |
|---------|---------|
| **Supported image formats** | JPEG, PNG |
| **Supported video formats** | MP4, MOV |
| **Max image size** | 8 MB (all plans) |
| **Max video size** | 250 MB (all plans) |
| **Storage backend** | Supabase Storage with signed URLs |
| **Upload flow** | react-dropzone → validate format/size → generate signed upload URL → upload to Supabase → track progress |
| **Instagram specifics** | PNG auto-converted to JPEG before upload |
| **Video thumbnails** | Timestamp-based cover image selection |

---

## Subscription Plans

| | Starter | Creator (Most Popular) | Pro |
|---|---------|:----------------------:|-----|
| **Monthly price** | $9/mo | $18/mo | $27/mo |
| **Yearly price** | $64/yr ($5.39/mo) | $129/yr ($10.75/mo) | $194/yr ($16.17/mo) |
| **Yearly savings** | ~40% | ~40% | ~40% |
| **Connected social accounts** | 5 | 15 | Unlimited (999) |
| **Posts per month** | Unlimited | Unlimited | Unlimited |
| **Scheduling** | Yes | Yes | Yes |
| **Storage** | 5 GB | 15 GB | 45 GB |
| **Image upload limit** | 8 MB/file | 8 MB/file | 8 MB/file |
| **Video upload limit** | 250 MB/file | 250 MB/file | 250 MB/file |
| **Multiple accounts per platform** | Yes | Yes | Yes |

**Feature gating:**
- Without subscription: account limit = 0, `SubscriptionPrompt` shown on `/create` and `/connections`.
- Storage enforcement: checked when generating upload URLs for scheduled posts.

---

## Social Platform Integrations

### LinkedIn

| Aspect | Detail |
|--------|--------|
| **Status** | Active |
| **API** | LinkedIn v2 |
| **OAuth scopes** | `openid`, `profile`, `email`, `w_member_social` |
| **Content types** | Text, Image, Video |
| **Caption limit** | 3000 characters |
| **Options** | Visibility: PUBLIC (default) |
| **Token refresh** | Refresh token available |
| **Account identifier** | Member URN (`urn:li:person:{id}`) |

### TikTok

| Aspect | Detail |
|--------|--------|
| **Status** | Active |
| **API** | TikTok API v2 |
| **OAuth scopes** | `user.info.basic`, `user.info.profile`, `video.publish`, `video.upload`, `user.info.stats` |
| **Content types** | Image, Video |
| **Caption limit** | 2200 characters |
| **Options** | Privacy level: SELF_ONLY (default), disable comments, disable duets, disable stitches |
| **Token refresh** | Refresh token available |
| **Notes** | Uses different client keys for dev/prod. Limited permissions may result in partial profile data. |

### Pinterest

| Aspect | Detail |
|--------|--------|
| **Status** | Active |
| **API** | Pinterest API v5 |
| **OAuth scopes** | `boards:read`, `boards:write`, `pins:read`, `pins:write`, `user_accounts:read`, `catalogs:read`, `catalogs:write` |
| **Content types** | Image, Video |
| **Caption limit** | 500 characters |
| **Options** | Board selection (required for posting), create new board, link URL (rich pins) |
| **Token refresh** | Refresh token available |

### Instagram

| Aspect | Detail |
|--------|--------|
| **Status** | Active (backend functional, **connect button disabled in UI**) |
| **API** | Instagram Graph API v23 (Instagram Login, new scopes as of Jan 2025) |
| **OAuth scopes** | `instagram_business_basic`, `instagram_business_content_publish` |
| **Content types** | Image (as feed post), Video (as Reels) |
| **Caption limit** | 2200 characters |
| **Options** | Alt text (1000 char), share to feed |
| **Token refresh** | **No refresh token**: tokens may expire, requiring reconnection |
| **Notes** | Requires Business/Creator account. PNG auto-converted to JPEG. Text-only posts not supported. |

### Facebook

| Aspect | Detail |
|--------|--------|
| **Status** | **Stub only: NOT functional** |
| **File** | `src/lib/api/facebook/facebook.ts` (empty handler) |

### Twitter/X

| Aspect | Detail |
|--------|--------|
| **Status** | **Stub only: NOT functional** |
| **File** | `src/lib/api/twitter/twitter.ts` (empty handler) |

### Not Implemented (Type Definitions Only)

- **Threads**: referenced in `dbTypes.ts`, no implementation
- **YouTube**: referenced in `dbTypes.ts` and landing page platform list, no implementation
- **Bluesky**: referenced in landing page platform list, no implementation

---

## Tech Stack

| Category | Technology | Version |
|----------|-----------|---------|
| **Framework** | Next.js (App Router, Turbopack) | 16.1.6 |
| **Language** | TypeScript | 5.9 |
| **UI Library** | React | 19.2 |
| **Styling** | Tailwind CSS | 4.1 |
| **Component Library** | shadcn/ui (new-york style, zinc base, 30+ components) | latest |
| **Icons** | Lucide React, Tabler Icons | 0.485 / 3.35 |
| **Fonts** | Geist Sans, Geist Mono | via `next/font` |
| **Authentication** | Clerk (`@clerk/nextjs`) | 7.0 |
| **Database** | Supabase (PostgreSQL + Row Level Security) | 2.75 |
| **Object Storage** | Supabase Storage (signed URLs, bucket: `scheduled-videos`) | via `@supabase/supabase-js` |
| **Payments** | Stripe (subscriptions, checkout, customer portal, webhooks) | 18.5 |
| **Rate Limiting** | Upstash Ratelimit (sliding window) + Upstash Redis | 2.0 / 1.35 |
| **Task Scheduling** | Upstash QStash | 2.8 |
| **Analytics** | Vercel Analytics + Speed Insights | 1.5 / 1.2 |
| **Charts** | Recharts | 2.15 |
| **Form Validation** | Zod | 3.25 |
| **Date Handling** | date-fns | 4.1 |
| **Date Picker** | react-day-picker | 8.10 |
| **Drag & Drop** | @dnd-kit (core, sortable, modifiers, utilities) | 6.3 / 10.0 / 9.0 |
| **Notifications** | Sonner (toast) | 2.0 |
| **Drawer** | Vaul | 1.1 |
| **File Upload** | react-dropzone | 14.3 |
| **HTTP Client** | Axios | 1.12 |
| **Webhook Verification** | Svix | 1.76 |
| **ID Generation** | nanoid, uuid | 5.1 / 11.1 |
| **i18n** | i18next, react-i18next, next-i18next | 25.5 / 15.7 / 15.4 |
| **Themes** | next-themes (light/dark mode support) | 0.4 |
| **SEO** | next-sitemap | 4.2 |
| **Tables** | @tanstack/react-table | 8.21 |
| **Deployment** | Vercel (functions max 60s for `/api/direct/**`) | |
| **Linting** | ESLint + eslint-config-next | 9.37 |
| **Package Manager** | Bun | |

---

## Environment Variables

| Variable | Description | Required Dev | Required Prod |
|----------|-------------|:------------:|:-------------:|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk public key | Yes | Yes |
| `CLERK_SECRET_KEY` | Clerk server secret | Yes | Yes |
| `CLERK_WEBHOOK_SECRET_DEV` | Clerk webhook secret (dev) | Yes | No |
| `CLERK_WEBHOOK_SECRET` | Clerk webhook secret (prod) | No | Yes |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes | Yes |
| `NEXT_PUBLIC_SUPABASE_SERVICE_KEY` | Supabase service key (public-facing) | Yes | Yes |
| `SUPABASE_SERVICE_ROLE` | Supabase service role key (admin, bypasses RLS) | Yes | Yes |
| `SUPABASE_BUCKET_NAME` | Supabase storage bucket name (`scheduled-videos`) | Yes | Yes |
| `STRIPE_PUBLISHABLE_KEY` | Stripe public key | Yes | Yes |
| `STRIPE_SECRET_KEY` | Stripe secret key | Yes | Yes |
| `STRIPE_WEBHOOK_SECRET_DEV` | Stripe webhook secret (dev) | Yes | No |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook secret (prod) | No | Yes |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis endpoint | Yes | Yes |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis auth token | Yes | Yes |
| `QSTASH_URL` | QStash endpoint | Yes | Yes |
| `QSTASH_TOKEN` | QStash auth token | Yes | Yes |
| `QSTASH_CURRENT_SIGNING_KEY` | QStash webhook verification key | Yes | Yes |
| `QSTASH_NEXT_SIGNING_KEY` | QStash next rotation key | Yes | Yes |
| `LINKEDIN_CLIENT_ID` | LinkedIn OAuth app ID | Yes | Yes |
| `LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth secret | Yes | Yes |
| `LINKEDIN_REDIRECT_URL` | LinkedIn OAuth callback URL | Yes | Yes |
| `TIKTOK_CLIENT_KEY` | TikTok OAuth key (prod) | No | Yes |
| `TIKTOK_CLIENT_SECRET` | TikTok OAuth secret (prod) | No | Yes |
| `TIKTOK_CLIENT_KEY_DEV` | TikTok OAuth key (dev) | Yes | No |
| `TIKTOK_CLIENT_SECRET_DEV` | TikTok OAuth secret (dev) | Yes | No |
| `TIKTOK_REDIRECT_URL` | TikTok OAuth callback URL | Yes | Yes |
| `PINTEREST_CLIENT_ID` | Pinterest OAuth app ID | Yes | Yes |
| `PINTEREST_CLIENT_SECRET` | Pinterest OAuth secret | Yes | Yes |
| `PINTEREST_REDIRECT_URL` | Pinterest OAuth callback URL | Yes | Yes |
| `INSTAGRAM_CLIENT_ID` | Instagram/Meta app ID | Yes | Yes |
| `INSTAGRAM_CLIENT_SECRET` | Instagram/Meta app secret | Yes | Yes |
| `INSTAGRAM_REDIRECT_URL` | Instagram OAuth callback URL | Yes | Yes |
| `RESEND_API` | Resend email API key | `[TO VERIFY]` | `[TO VERIFY]` |
| `FRONTEND_URL` | App base URL (e.g., `http://localhost:3000`) | Yes | Yes |
| `CRON_SECRET_KEY` | Bearer token for cron endpoints | Yes | Yes |
| `NODE_ENV` | Environment (`development` / `production`) | Auto | Auto |

> **Warning:** Never commit real secrets. Use `.env.local` for local development.

---

## Project Structure

```
sharetopus/
├── public/                          # Static assets (images, 404.webp, icons)
├── src/
│   ├── actions/                     # Server actions & business logic
│   │   ├── api/                     # Supabase client instances (admin + user-scoped)
│   │   ├── client/                  # Client-side actions (signed URLs)
│   │   ├── server/
│   │   │   ├── accounts/            # Account management helpers
│   │   │   ├── connections/         # checkAccountLimits, OAuth helpers
│   │   │   ├── contentHistoryActions/ # Content history CRUD
│   │   │   ├── data/                # Data fetching (fetchSocialAccounts, etc.)
│   │   │   ├── rateLimit/           # Upstash rate limiting wrapper
│   │   │   ├── scheduleActions/     # Schedule CRUD (cancel, resume, reschedule, delete)
│   │   │   └── stripe/              # Checkout session, customer portal, subscription checks
│   │   └── ui/                      # UI-related server actions
│   ├── app/                         # Next.js App Router
│   │   ├── (marketing)/             # Public route group
│   │   │   ├── page.tsx             # Landing page (/)
│   │   │   ├── PrivacyPolicy/       # Privacy policy (/PrivacyPolicy)
│   │   │   └── tos/                 # Terms of service (/tos)
│   │   ├── (protected)/             # Auth-required route group
│   │   │   ├── layout.tsx           # Sidebar layout + ensureUserExists()
│   │   │   ├── create/              # Post creation (/create, /create/text, /create/image, /create/video)
│   │   │   ├── connections/         # Social accounts (/connections)
│   │   │   ├── scheduled/           # Scheduled posts (/scheduled)
│   │   │   ├── posted/              # Content history (/posted)
│   │   │   ├── studio/              # Analytics - coming soon (/studio)
│   │   │   ├── userProfile/         # Clerk profile (/userProfile)
│   │   │   └── payment/success/     # Checkout success (/payment/success)
│   │   ├── api/                     # API route handlers
│   │   │   ├── auth/[clerk]/        # Clerk auth catch-all
│   │   │   ├── cron/                # Scheduled post processing
│   │   │   ├── media/               # Media proxy
│   │   │   ├── social/              # OAuth + posting (linkedin/, tiktok/, pinterest/, instagram/)
│   │   │   ├── storage/             # Upload/view URL generation
│   │   │   └── webhooks/            # Stripe + Clerk webhooks
│   │   ├── layout.tsx               # Root layout (ClerkProvider, fonts, SEO metadata)
│   │   ├── not-found.tsx            # Custom 404 page
│   │   └── robots.ts                # robots.txt generation
│   ├── components/
│   │   ├── core/                    # Feature-specific components
│   │   │   ├── accounts/            # Connect buttons, account badges, ConnectionLimitModal
│   │   │   ├── create/              # SocialPostForm, upload handlers, upload limits constants
│   │   │   ├── posted/              # ContentHistoryCard, RenderPosts, empty states
│   │   │   └── scheduled/           # BatchedPostCard, PostsGrid, EmptyContent
│   │   ├── icons/                   # Custom SVG icon components
│   │   ├── marketing-page/          # Landing page sections (hero, pricing, testimonials, etc.)
│   │   ├── sidebar/                 # App navigation (app-sidebar, Site-Header, nav-*)
│   │   ├── suspense/                # Skeleton loading components per section
│   │   ├── ui/                      # shadcn/ui primitives (30+ components)
│   │   ├── ComingSoon.tsx           # "Coming Soon" placeholder
│   │   ├── RateLimitError.tsx       # Rate limit error with countdown timer
│   │   └── SubscriptionPrompt.tsx   # Subscription paywall gate
│   ├── hooks/                       # Custom React hooks
│   ├── lib/
│   │   ├── api/                     # Social platform API implementations
│   │   │   ├── facebook/            # Stub (empty handler)
│   │   │   ├── instagram/           # Instagram Graph API v23
│   │   │   ├── linkedin/            # LinkedIn v2 API
│   │   │   ├── pinterest/           # Pinterest v5 API
│   │   │   ├── tiktok/              # TikTok v2 API
│   │   │   └── twitter/             # Stub (empty handler)
│   │   ├── types/                   # TypeScript types (plans.ts, dbTypes.ts)
│   │   ├── stripe.ts                # Stripe SDK initialization
│   │   └── utils.ts                 # Utility functions (cn helper)
│   └── middleware.ts                # Clerk auth middleware
├── i18n-config.ts                   # i18n config (fr default, en, es: not translated)
├── next.config.ts                   # Next.js config (image domains, 5MB body limit)
├── next-sitemap.config.js           # Sitemap config (siteUrl: sharetopus.com)
├── vercel.json                      # Vercel function config (60s timeout)
├── components.json                  # shadcn/ui configuration
├── package.json                     # Dependencies and scripts
└── tsconfig.json                    # TypeScript configuration
```

---

## Getting Started

### Prerequisites

- **Node.js** 18+ (LTS recommended)
- **Bun** (package manager: `bun.lock` present) or npm/yarn as fallback
- **Stripe CLI** (for local webhook testing)
- **Accounts required:**
  - [Clerk](https://clerk.com): authentication
  - [Supabase](https://supabase.com): database + file storage
  - [Stripe](https://stripe.com): subscription payments
  - [Upstash](https://upstash.com): Redis (rate limiting) + QStash (scheduled jobs)
  - Platform developer apps: [LinkedIn](https://developer.linkedin.com/), [TikTok](https://developers.tiktok.com/), [Pinterest](https://developers.pinterest.com/), [Instagram/Meta](https://developers.facebook.com/)

### Installation

```bash
# 1. Clone the repository
git clone <repo-url>
cd sharetopus

# 2. Install dependencies
bun install

# 3. Set up environment variables
cp .env.example .env.local
# Fill in ALL required variables (see Environment Variables section above)

# 4. Set up Supabase
# - Create tables matching the Database Schema section
# - Enable Row Level Security (RLS) policies
# - Create a storage bucket named "scheduled-videos"

# 5. Set up Stripe
# - Create 3 products with monthly + yearly prices matching plan definitions
# - Configure webhook endpoint: <your-url>/api/webhooks/stripe
# - Events to listen for: customer.subscription.*, invoice.payment_*

# 6. Set up Clerk
# - Configure sign-in methods in Clerk dashboard
# - Configure webhook endpoint: <your-url>/api/webhooks/clerk
# - Events: user.created, user.updated, user.deleted

# 7. Run development server
bun dev
```

The app will be available at `http://localhost:3000`.

### Local Webhook Testing

```bash
# Stripe webhooks
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# Clerk webhooks (use Clerk dashboard or ngrok)
```

### Build & Production

```bash
bun run build
bun start
```

---

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `next dev --turbopack` | Start development server with Turbopack |
| `build` | `next build` | Create production build |
| `start` | `next start` | Start production server |
| `lint` | `next lint` | Run ESLint |

---

## Database Schema

### `users`

| Column | Type | Description |
|--------|------|-------------|
| `id` | text (PK) | Clerk user ID |
| `email` | text | User email |
| `first_name` | text? | First name |
| `last_name` | text? | Last name |
| `stripe_customer_id` | text? | Stripe customer ID |
| `created_at` | timestamptz | Creation timestamp |
| `updated_at` | timestamptz | Last update |

### `social_accounts`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Auto-generated |
| `user_id` | text (FK → users) | Owner |
| `platform` | text | `linkedin`, `tiktok`, `pinterest`, `instagram`, `facebook` |
| `account_identifier` | text | Platform-specific user ID |
| `access_token` | text | OAuth access token |
| `refresh_token` | text? | OAuth refresh token (unavailable for Instagram) |
| `is_available` | boolean | Account availability flag |
| `token_expires_at` | timestamptz? | Token expiration time |
| `username` | text? | Platform username |
| `display_name` | text? | Display name |
| `avatar_url` | text? | Profile picture URL |
| `is_verified` | boolean? | Verified status |
| `follower_count` | integer? | Follower count |
| `following_count` | integer? | Following count |
| `bio_description` | text? | User bio |
| `extra` | jsonb | Platform-specific profile data |
| `created_at` | timestamptz? | |
| `updated_at` | timestamptz? | |

**Unique constraint:** `(user_id, platform, account_identifier)`

### `scheduled_posts`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | |
| `user_id` | text (FK → users) | Owner |
| `social_account_id` | uuid (FK → social_accounts) | Target account |
| `platform` | text | Target platform |
| `status` | text | `scheduled`, `processing`, `posted`, `failed`, `cancelled` |
| `scheduled_at` | timestamptz | Planned publish time |
| `posted_at` | timestamptz? | Actual publish time |
| `post_title` | text? | Post title |
| `post_description` | text? | Post body/caption |
| `post_options` | jsonb | Platform options (board_id, privacy, etc.) |
| `media_type` | text | `text`, `image`, `video` |
| `media_storage_path` | text | Supabase storage path |
| `error_message` | text? | Error details if failed |
| `batch_id` | text | Groups multi-account posts together |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `content_history`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | |
| `user_id` | text (FK → users) | Owner |
| `platform` | text | Published platform |
| `content_id` | text | Platform's post ID |
| `title` | text? | Post title |
| `description` | text? | Post caption |
| `media_url` | text? | Media URL |
| `extra` | jsonb | Platform response, post_type, posted_at, board_info |
| `status` | text? | Post status |
| `media_type` | text? | Content type |
| `social_account_id` | uuid | Account used |
| `batch_id` | text | Batch reference |
| `created_at` | timestamptz | |

### `failed_posts`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | |
| `user_id` | text | Owner |
| `social_account_id` | uuid | Target account |
| `platform` | text | Target platform |
| `post_title` | text? | Content title |
| `post_description` | text? | Content body |
| `media_type` | text | Content type |
| `media_storage_path` | text | Storage path |
| `error_message` | text | Error details |
| `extra_data` | jsonb | Additional context |
| `batch_id` | text | Batch reference |
| `created_at` | timestamptz | |

### `stripe_subscriptions`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | |
| `user_id` | text (FK → users) | Owner |
| `stripe_subscription_id` | text | Stripe subscription ID |
| `stripe_customer_id` | text | Stripe customer ID |
| `stripe_price_id` | text | Stripe price ID (maps to plan tier) |
| `plan` | text | `starter`, `creator`, `pro` |
| `status` | text | `active`, `canceled`, `past_due`, `trialing`, `incomplete` |
| `start_date` | timestamptz | Subscription start |
| `current_period_end` | timestamptz | Current billing period end |
| `cancel_reason` | text? | Cancellation reason |
| `amount` | integer | Price in cents |
| `currency` | text | Currency code |
| `is_active` | boolean | Active flag |
| `metadata` | jsonb | Additional data |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `stripe_invoices`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | |
| `user_id` | text | Owner |
| `stripe_invoice_id` | text | Stripe invoice ID |
| `amount_paid` | integer? | Amount in cents |
| `currency` | text | Currency code |
| `status` | text | `paid`, `failed` |
| `created_at` | timestamptz | |

### `analytics_metrics`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | |
| `user_id` | text (FK → users) | Owner |
| `platform` | text | Platform |
| `content_id` | text? | Post reference |
| `views` | bigint? | View count |
| `comments` | bigint? | Comment count |
| `subscribers` | bigint? | Subscriber count |
| `extra` | jsonb? | Additional metrics |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

---

## Security

### Rate Limiting (Upstash Redis: Sliding Window)

| Operation | Limit | Window | Identifier |
|-----------|-------|--------|------------|
| Stripe checkout session | 15 requests | 60 seconds | userId |
| Customer portal access | 20 requests | 60 seconds | userId |
| Fetch social accounts | 30 requests | 60 seconds | userId |
| Get Pinterest boards | 15 requests | 60 seconds | userId |
| Get scheduled posts | 60 requests | 60 seconds | userId |
| Direct post (LinkedIn) | 25 requests | 60 seconds | userId |
| Post to social media (general) | 30 requests | 60 seconds | userId |

### Other Security Measures

| Measure | Implementation |
|---------|---------------|
| **CSRF protection** | OAuth flows use `nanoid(32)` state tokens stored in HTTP-only, secure cookies with 15-minute expiration |
| **Webhook verification** | Stripe: `stripe.webhooks.constructEventAsync()` with signing secret. Clerk: Svix signature verification via `svix-id`, `svix-timestamp`, `svix-signature` headers |
| **Media path sanitization** | Media proxy (`/api/media`) validates file paths: rejects `..`, `//`, leading `/` to prevent path traversal |
| **Row Level Security** | Supabase RLS policies on all tables. User-scoped client passes Clerk JWT token; admin client uses service role for system operations |
| **Subscription enforcement** | `checkActiveSubscription()` gates all user-facing features before allowing actions |
| **Account limit enforcement** | `checkAccountLimits()` validates plan limits before allowing OAuth initiation |
| **Cron authentication** | `/api/cron/*` routes require `Authorization: Bearer <CRON_SECRET_KEY>` header |
| **Input validation** | Zod schemas for form validation; file type and size validation on media uploads |
| **Server action body limit** | 5MB max body size configured in `next.config.ts` |

---

## Known Issues & Limitations

| Item | Status | Details |
|------|--------|---------|
| **Studio / Analytics** | Coming Soon | `/studio` renders a "COMING SOON" placeholder. `analytics_metrics` table schema exists but is not populated by any feature. |
| **Facebook integration** | Stub only | `src/lib/api/facebook/facebook.ts` exists but is empty. No OAuth flow, no posting, no UI. |
| **Twitter/X integration** | Stub only | `src/lib/api/twitter/twitter.ts` exists but is empty. No OAuth flow, no posting, no UI. |
| **Instagram connection** | Disabled in UI | Connect button is **commented out** in `/connections` page source. Backend OAuth routes and posting logic are functional. |
| **Threads, YouTube, Bluesky** | Type definitions only | Referenced in `dbTypes.ts` and on the landing page platform list as supported, but no implementation exists. |
| **i18n** | Declared, not implemented | `i18n-config.ts` defines `fr` (default), `en`, `es` locales. i18next dependencies installed. However, actual translations are absent: the entire UI is in English. |
| **Text posts** | LinkedIn only | Only LinkedIn supports text-only posts. TikTok, Pinterest, and Instagram all require an image or video. |
| **Instagram refresh tokens** | Not available | Instagram API does not provide refresh tokens. Access tokens expire and require the user to reconnect. |
| **TikTok default privacy** | SELF_ONLY | TikTok posts default to private (`SELF_ONLY`). Users must manually change this option in the create form for public visibility. |
| **404 page metadata** | Placeholder | The 404 page title says "Your Site Name" instead of "Sharetopus". |
| **Landing page stats** | Hardcoded | Stats section values (195,694 posts published, 3h 4m weekly time saved) are hardcoded, not fetched from live data. |
| **Stripe API version** | Pinned | Uses Stripe API version `2025-08-27.basil` `[TO VERIFY]` |

---

## Architecture Reference

For a detailed deep-dive into the system architecture, data flow diagrams, internal design decisions, and component relationships, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## License

`[TO VERIFY]`

---

<p align="center">
  Built with ❤️ by the Sharetopus team<br/>
  <a href="https://sharetopus.com">sharetopus.com</a> · <a href="mailto:sharetopusInc@gmail.com">sharetopusInc@gmail.com</a>
</p>
