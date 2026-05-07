# Deployment

Sharetopus is deployed on Vercel at [https://sharetopus.com](https://sharetopus.com).

## Hosting

The production app runs on Vercel using standard Next.js deployment. There is no CI/CD configuration file in the repo; deployment is handled by Vercel's git auto-deploy (pushes to the main branch trigger a production build).

## vercel.json

The `vercel.json` file sets a `maxDuration` of 60 seconds for `/api/direct/**` routes:

```json
{
  "functions": {
    "api/direct/**": {
      "maxDuration": 60
    }
  }
}
```

Note: no `/api/direct/` routes currently exist in the codebase. This config has no practical effect at this time.

## Environment Strategy

Several services use separate environment variables for development and production. The app checks `NODE_ENV` to decide which key to use.

| Service | Production variable | Development variable |
|---------|-------------------|---------------------|
| Clerk webhooks | `CLERK_WEBHOOK_SECRET` | `CLERK_WEBHOOK_SECRET_DEV` |
| Stripe webhooks | `STRIPE_WEBHOOK_SECRET` | `STRIPE_WEBHOOK_SECRET_DEV` |
| TikTok client key | `TIKTOK_CLIENT_KEY` | `TIKTOK_CLIENT_KEY_DEV` |
| TikTok client secret | `TIKTOK_CLIENT_SECRET` | `TIKTOK_CLIENT_SECRET_DEV` |

All other variables (Clerk keys, Supabase, Stripe keys, Upstash, LinkedIn, Pinterest, Instagram) use the same variable name in both environments, set to different values in each.

See the full list in [env-vars.md](../reference/env-vars.md).

## Development Server

Local development uses Bun with Turbopack:

```bash
bun dev
```

This runs `next dev --turbopack` as defined in `package.json`.

## Staging

There is no staging environment configured. The only two environments are local development and Vercel production.

---

[Back to Operations](./README.md) | [Back to docs](../README.md) | [Back to project root](../../README.md)
