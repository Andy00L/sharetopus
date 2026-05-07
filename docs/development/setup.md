# Local Development Setup

How to get Sharetopus running on your machine. For a minimal quick-start, see [quick-start.md](../getting-started/quick-start.md). This page covers the full setup.

## 1. Install dependencies

```bash
git clone <repo-url>
cd sharetopus
bun install
```

Bun is the package manager (`bun.lock` is committed). Node.js 18+ is required by Next.js.

## 2. Configure environment variables

Create a `.env.local` file at the project root. There is no `.env.example` in the repo. See [env-vars.md](../reference/env-vars.md) for the full list of variables.

At minimum, you need the Clerk, Supabase, Stripe, and Upstash variables for the app to start.

For development, use the `_DEV`-suffixed variables where they exist:
- `CLERK_WEBHOOK_SECRET_DEV` (instead of `CLERK_WEBHOOK_SECRET`)
- `STRIPE_WEBHOOK_SECRET_DEV` (instead of `STRIPE_WEBHOOK_SECRET`)
- `TIKTOK_CLIENT_KEY_DEV` and `TIKTOK_CLIENT_SECRET_DEV` (instead of the production TikTok keys)

## 3. Set up Supabase

1. Create a Supabase project.
2. Run the migration file to create all 27 tables:
   - Open the SQL Editor in the Supabase dashboard.
   - Paste and execute the contents of `supabase/migrations/20260506000001_initial_schema.sql`.
3. Create a storage bucket named **`scheduled-videos`**. This bucket stores uploaded media for scheduled posts.
4. Copy your project URL, anon key, and service role key into the corresponding env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE`).

See [database.md](../reference/database.md) for the full schema reference.

## 4. Set up Stripe webhooks with the Stripe CLI

For local development, use the Stripe CLI to forward webhook events to your local server:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

The CLI prints a webhook signing secret on startup. Set that value as `STRIPE_WEBHOOK_SECRET_DEV` in your `.env.local`.

You also need `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` from your Stripe dashboard.

## 5. Set up social platform developer apps

For each platform you want to test (LinkedIn, TikTok, Pinterest, Instagram):

1. Create a developer application on the platform.
2. Configure the OAuth redirect URL to point to your local callback route (e.g., `http://localhost:3000/api/social/linkedin/connect`).
3. Copy the client ID, client secret, and redirect URL into the corresponding env vars.

See [env-vars.md](../reference/env-vars.md) for the variable names per platform.

TikTok requires separate dev credentials (`TIKTOK_CLIENT_KEY_DEV`, `TIKTOK_CLIENT_SECRET_DEV`). The other platforms use the same variable names in dev and prod.

## 6. Start the development server

```bash
bun dev
```

This runs `next dev --turbopack`. The app is available at [http://localhost:3000](http://localhost:3000).

---

[Back to Development](./README.md) | [Back to docs](../README.md) | [Back to project root](../../README.md)
