# Quick Start

Minimum steps to get Sharetopus running locally. This assumes you already have all third-party accounts (Clerk, Supabase, Stripe, Upstash, social platform developer apps) created and configured. If you do not, see [installation.md](./installation.md) for the full setup guide.

## 1. Install dependencies

```bash
git clone <repo-url>
cd sharetopus
bun install
```

## 2. Set environment variables

Create a `.env.local` file at the project root and fill in all required values. See [configuration.md](./configuration.md) for the complete variable reference.

```bash
touch .env.local
```

At minimum, the following groups must be populated for the app to start:

- Clerk keys (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`)
- Supabase keys (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE`)
- Stripe keys (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`)
- Upstash keys (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `QSTASH_TOKEN`)

## 3. Start the dev server

```bash
bun dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

[Back to Getting Started](./README.md) | [Back to docs](../README.md) | [Back to project README](../../README.md)
