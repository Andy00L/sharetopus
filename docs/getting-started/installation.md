# Installation

Complete setup guide for Sharetopus. If you already have all third-party accounts configured and just want to run the app, see [quick-start.md](./quick-start.md).

## Prerequisites

- **Node.js 18+** (required by Next.js 16)
- **Bun** (package manager, `bun.lock` is committed to the repo)
- **Stripe CLI** (for local webhook testing)

## Third-Party Accounts

You will need accounts (and developer app credentials where noted) for all of the following services before Sharetopus can run:

| Service | What it provides | Sign-up |
|---------|-----------------|---------|
| Clerk | Authentication (sign-in, sign-up, user management) | [clerk.com](https://clerk.com) |
| Supabase | PostgreSQL database and file storage | [supabase.com](https://supabase.com) |
| Stripe | Subscription billing and payment processing | [stripe.com](https://stripe.com) |
| Upstash | Redis (rate limiting) and QStash (scheduled job delivery) | [upstash.com](https://upstash.com) |
| LinkedIn | Developer app for OAuth posting | [linkedin.com/developers](https://www.linkedin.com/developers/) |
| TikTok | Developer app for OAuth posting | [developers.tiktok.com](https://developers.tiktok.com) |
| Pinterest | Developer app for OAuth posting | [developers.pinterest.com](https://developers.pinterest.com) |
| Instagram / Meta | Developer app for OAuth posting (Meta Business platform) | [developers.facebook.com](https://developers.facebook.com) |

## Step-by-Step Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd sharetopus
bun install
```

### 2. Configure environment variables

There is no `.env.example` file in the repo. Create a `.env.local` file at the project root and populate every variable listed in [configuration.md](./configuration.md). At minimum you need the Clerk, Supabase, Stripe, and Upstash variables for the app to start.

```bash
touch .env.local
# Open .env.local in your editor and add all required values.
```

See [configuration.md](./configuration.md) for the full reference table.

### 3. Set up Supabase

1. Create a new Supabase project.
2. Open the SQL Editor in the Supabase dashboard.
3. Paste and run the migration file at `supabase/migrations/20260506000001_initial_schema.sql`. This creates all 27 tables.
4. Create a storage bucket named **`scheduled-videos`**. This bucket stores uploaded media (images and videos) for scheduled posts.
5. Enable Row Level Security (RLS) on all tables. The migration file includes RLS policies, but verify they are active in the Supabase dashboard under Authentication > Policies.
6. Copy your project URL and anon key into `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Copy the service role key into `SUPABASE_SERVICE_ROLE`.

### 4. Set up Stripe

1. In the Stripe dashboard, create **3 products** corresponding to the subscription tiers (Starter, Creator, Pro).
2. For each product, create **two prices**: one monthly and one yearly.
3. Register a webhook endpoint pointing to your app's Stripe webhook route. The events to subscribe to are:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET` (production) or `STRIPE_WEBHOOK_SECRET_DEV` (local development).
5. Copy your Stripe secret key into `STRIPE_SECRET_KEY` and your publishable key into `STRIPE_PUBLISHABLE_KEY`.

### 5. Set up Clerk

1. Create a Clerk application.
2. Configure your preferred sign-in methods (email, OAuth, etc.) in the Clerk dashboard.
3. Register a webhook endpoint for Clerk. The events to subscribe to are:
   - `user.created`
   - `user.updated`
   - `user.deleted`
4. Copy the webhook signing secret into `CLERK_WEBHOOK_SECRET` (production) or `CLERK_WEBHOOK_SECRET_DEV` (local development).
5. Copy your publishable key into `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and your secret key into `CLERK_SECRET_KEY`.

### 6. Set up Upstash

1. Create an Upstash Redis database for rate limiting.
2. Copy the REST URL and token into `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. Create a QStash instance (or use the same Upstash account). Copy the QStash token into `QSTASH_TOKEN`.

### 7. Set up social platform developer apps

For each social platform you want to support (LinkedIn, TikTok, Pinterest, Instagram), create a developer application on the respective platform and configure OAuth redirect URLs. Copy the client ID, client secret, and redirect URL into the corresponding env vars (see [configuration.md](./configuration.md) for the full list).

### 8. Local webhook testing with Stripe CLI

For local development, use the Stripe CLI to forward webhook events to your local server:

```bash
stripe listen --forward-to http://localhost:3000/api/webhooks/stripe
```

The CLI will print a webhook signing secret. Use that value for `STRIPE_WEBHOOK_SECRET_DEV` in your `.env.local`.

### 9. Start the development server

```bash
bun dev
```

The app runs at [http://localhost:3000](http://localhost:3000).

---

[Back to Getting Started](./README.md) | [Back to docs](../README.md) | [Back to project README](../../README.md)
