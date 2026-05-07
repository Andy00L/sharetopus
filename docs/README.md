# Sharetopus Documentation

Complete documentation for the Sharetopus social media publishing platform.

## Sections

### [Getting Started](./getting-started/README.md)

Installation prerequisites, quick-start walkthrough, and full configuration reference.

| File | Contents |
|------|----------|
| [installation.md](./getting-started/installation.md) | Requirements, dependencies, third-party account setup |
| [quick-start.md](./getting-started/quick-start.md) | Minimum viable run-through |
| [configuration.md](./getting-started/configuration.md) | Full environment variable reference and config files |

### [Architecture](./architecture/README.md)

System design, component relationships, and data flow.

| File | Contents |
|------|----------|
| [components.md](./architecture/components.md) | Directory-by-directory breakdown of the codebase |
| [data-flow.md](./architecture/data-flow.md) | Sequence diagrams for posting, scheduling, OAuth, payments |
| [state-management.md](./architecture/state-management.md) | Database tables, in-memory state, scheduled post lifecycle |
| [lifecycles.md](./architecture/lifecycles.md) | Startup, request processing, cron jobs |
| [design-decisions.md](./architecture/design-decisions.md) | Why things are built the way they are, known limits |

### [Features](./features/README.md)

Per-feature deep dives.

| File | Contents |
|------|----------|
| [content-creation.md](./features/content-creation.md) | Text, image, and video posting across platforms |
| [scheduling.md](./features/scheduling.md) | How scheduling works end-to-end with QStash |
| [social-accounts.md](./features/social-accounts.md) | OAuth connections, plan limits, token refresh |
| [content-history.md](./features/content-history.md) | Post tracking and batch grouping |
| [payments.md](./features/payments.md) | Stripe subscriptions, checkout, customer portal |
| [mcp-server.md](./features/mcp-server.md) | MCP tools, resources, prompts, auth paths |

### [Integrations](./integrations/README.md)

External service details.

| File | Contents |
|------|----------|
| [linkedin.md](./integrations/linkedin.md) | LinkedIn v2 API integration |
| [tiktok.md](./integrations/tiktok.md) | TikTok v2 API integration |
| [pinterest.md](./integrations/pinterest.md) | Pinterest v5 API integration |
| [instagram.md](./integrations/instagram.md) | Instagram Graph API v23 integration |
| [clerk.md](./integrations/clerk.md) | Authentication, middleware, webhooks |
| [stripe.md](./integrations/stripe.md) | Billing, webhooks, subscription lifecycle |
| [supabase.md](./integrations/supabase.md) | Database, storage, RLS |
| [upstash.md](./integrations/upstash.md) | Redis rate limiting and QStash scheduling |

### [Reference](./reference/README.md)

API surface, env vars, and database schema.

| File | Contents |
|------|----------|
| [api.md](./reference/api.md) | Every HTTP route with method, path, auth, description |
| [env-vars.md](./reference/env-vars.md) | Master environment variable table |
| [database.md](./reference/database.md) | All 27 tables with columns, types, and relationships |

### [Operations](./operations/README.md)

Deployment and troubleshooting.

| File | Contents |
|------|----------|
| [deployment.md](./operations/deployment.md) | Vercel deployment, environment strategy |
| [troubleshooting.md](./operations/troubleshooting.md) | Common issues and fixes |

### [Development](./development/README.md)

Local development setup and testing.

| File | Contents |
|------|----------|
| [setup.md](./development/setup.md) | Full local dev setup beyond quick-start |
| [testing.md](./development/testing.md) | How to run tests |

---

[Back to README](../README.md)
