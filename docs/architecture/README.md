# Architecture Overview

Sharetopus is a single Next.js 16 application (App Router, not a monorepo) that lets users connect social media accounts, compose posts, and publish or schedule them across LinkedIn, TikTok, Pinterest, and Instagram. The codebase contains 268 source files (.ts/.tsx) with roughly 350 export lines. Authentication is handled by Clerk, persistent state lives in Supabase (PostgreSQL + Storage), payments go through Stripe, and scheduled post delivery is driven by Upstash QStash cron triggers.

## System Architecture

```mermaid
graph TD
    Browser["Browser (React Client)"]

    subgraph NextServer["Next.js Server"]
        Middleware["src/middleware.ts (Clerk auth)"]
        APIRoutes["API Routes (src/app/api/)"]
        ServerActions["Server Actions (src/actions/server/)"]
        Webhooks["Webhooks (clerk, stripe)"]
    end

    Clerk["Clerk (Auth)"]
    Supabase["Supabase (PostgreSQL + Storage)"]
    SocialAPIs["Social Platform APIs"]
    Stripe["Stripe (Payments)"]
    Upstash["Upstash (Redis + QStash)"]

    Browser -->|requests| Middleware
    Middleware -->|authenticated| APIRoutes
    Middleware -->|authenticated| ServerActions
    Browser -->|sign-in / sign-up| Clerk
    Clerk -->|JWT| Middleware

    APIRoutes -->|queries / mutations| Supabase
    ServerActions -->|queries / mutations| Supabase
    APIRoutes -->|OAuth + post| SocialAPIs
    APIRoutes -->|rate limit check| Upstash

    Stripe -->|webhook events| Webhooks
    Clerk -->|webhook events| Webhooks
    Webhooks -->|upsert data| Supabase

    Upstash -->|"POST /api/cron/process-scheduled-posts"| APIRoutes
    APIRoutes -->|publish scheduled posts| SocialAPIs

    SocialAPIs -->|LinkedIn| SocialAPIs
    SocialAPIs -->|TikTok| SocialAPIs
    SocialAPIs -->|Pinterest| SocialAPIs
    SocialAPIs -->|Instagram| SocialAPIs
```

## Architecture Files

| File | Contents |
|------|----------|
| [components.md](./components.md) | Directory-by-directory breakdown of the codebase |
| [data-flow.md](./data-flow.md) | Sequence diagrams for OAuth, posting, scheduling, and payments |
| [state-management.md](./state-management.md) | Where state lives: database, storage, Redis, React |
| [lifecycles.md](./lifecycles.md) | Startup, request processing, and cron job lifecycles |
| [design-decisions.md](./design-decisions.md) | Why things are built the way they are, known tradeoffs |

---

[Documentation index](../README.md) | [Project root](../../README.md)
