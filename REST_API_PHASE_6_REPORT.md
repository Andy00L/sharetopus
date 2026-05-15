# REST API Phase 6 Report -- Docs + Webhooks UI + Replay + Quickstart

**Branch:** main (direct commit)
**Commit:** pending
**Build state:** green (tsc --noEmit + npm run build)
**Generated:** 2026-05-15

## Summary

Phase 6 ships developer experience: OpenAPI 3.1 spec at /api/v1/openapi.json (public, cached 1h), Scalar interactive API viewer at /docs/api, 3 MDX documentation pages (quickstart, authentication, webhooks) with dual React + .md rendering for AI agents, webhook delivery replay endpoint, full webhooks management UI at /settings/webhooks, and marketing nav + sidebar updates. Also removed unused @upstash/qstash dependency.

## Files Created

| File | Lines | Purpose |
|---|---|---|
| src/lib/api/rest/openapi/responseSchemas.ts | 130 | Zod schemas mirroring DTO shapes for OpenAPI |
| src/lib/api/rest/openapi/paths.ts | 250 | Registers all 25 endpoints with request/response specs |
| src/lib/api/rest/openapi/buildDocument.ts | 30 | Builds OpenAPI 3.1 document |
| src/app/api/v1/openapi.json/route.ts | 18 | Public cached GET endpoint |
| src/app/(marketing)/docs/layout.tsx | 30 | Docs sidebar navigation |
| src/app/(marketing)/docs/page.tsx | 45 | Docs landing page |
| src/app/(marketing)/docs/api/route.ts | 12 | Scalar API reference viewer |
| src/app/(marketing)/docs/quickstart/page.tsx | 15 | Quickstart MDX page |
| src/app/(marketing)/docs/authentication/page.tsx | 15 | Auth guide MDX page |
| src/app/(marketing)/docs/webhooks/page.tsx | 15 | Webhooks guide MDX page |
| src/content/docs/quickstart.mdx | 55 | Quickstart content |
| src/content/docs/authentication.mdx | 55 | Auth guide content |
| src/content/docs/webhooks.mdx | 115 | Webhooks guide content |
| src/lib/api/rest/docs/loadMdxRaw.ts | 30 | Reads MDX as raw markdown |
| src/app/api/docs/[slug]/route.ts | 25 | .md raw markdown endpoint |
| src/app/api/v1/webhooks/[id]/deliveries/[delivery_id]/replay/route.ts | 85 | Replay delivery endpoint |
| src/app/(protected)/settings/webhooks/page.tsx | 25 | Server component |
| src/app/(protected)/settings/webhooks/WebhooksClient.tsx | 130 | Client orchestrator |
| src/app/(protected)/settings/webhooks/components/WebhookList.tsx | 100 | Subscription list |
| src/app/(protected)/settings/webhooks/components/WebhookForm.tsx | 65 | Create form |
| src/app/(protected)/settings/webhooks/components/EventPicker.tsx | 35 | Event checkboxes |
| src/app/(protected)/settings/webhooks/components/DeliveryLog.tsx | 75 | Delivery log |
| src/mdx-components.tsx | 10 | Required by @next/mdx |

## Files Modified

| File | Change | Reason |
|---|---|---|
| next.config.ts | MDX plugin, pageExtensions, rewrites for .md | MDX + .md endpoint |
| package.json | Added deps, removed @upstash/qstash | New libs + cleanup |
| src/components/marketing-page/nav-bar/nav-items.tsx | Added "Docs" link | Surface docs |
| src/components/sidebar/nav-user.tsx | Added "Webhooks" entry + WebhookIcon | Surface UI |

## Dependencies Added/Removed

| Package | Action | Reason |
|---|---|---|
| zod-openapi | Added | OpenAPI generation from Zod schemas |
| @next/mdx | Added | MDX page support |
| @mdx-js/loader | Added | MDX webpack loader |
| @mdx-js/react | Added | MDX React runtime |
| @types/mdx | Added | MDX type definitions |
| @upstash/qstash | Removed | Zero imports in src/ (dead dependency) |

## OpenAPI Spec

- Endpoints registered: 25 (24 existing + 1 replay)
- Document version: OpenAPI 3.1.0
- Public access: yes (cached 1h)
- Scalar viewer: /docs/api

## MDX Architecture

- Source: src/content/docs/*.mdx (3 files)
- React render: via page.tsx importing MDX directly
- .md endpoint: /api/docs/[slug] via rewrite /docs/:slug.md
- Path sanitization: alphanumeric + dashes only

## Replay Endpoint

- Reuses dispatchWebhook (single source)
- Deleted subscription: 404
- Disabled subscription: 409
- Not owned delivery: 404

## Webhooks UI

- 6 components (page, client, list, form, event picker, delivery log)
- Reuses v1 REST endpoints via same-origin fetch
- Secret reveal once on create (dismiss banner)
- Status badges: green (2xx), red (failure), gray (pending)

## Cleanup

- @upstash/qstash removed (zero imports confirmed)

## Invariant Verification

| # | Check | Result |
|---|---|---|
| I3 | No .openapi() calls | PASS |
| I4 | No extendZodWithOpenApi | PASS |
| I5 | No throws in new handlers | PASS |
| I6 | dispatchWebhook reused for replay | PASS |
| I7 | No any | PASS |
| I8 | No em-dash | PASS |
| I9 | No z.uuid() | PASS |
| I10 | QStash removed | PASS |
| I11 | Build clean | PASS |
| I12 | MCP regression | PASS |

## Decisions Made

- Scalar: route handler pattern (not React component) per @scalar/nextjs-api-reference API
- OpenAPI: hand-built paths referencing runtime Zod schemas (avoids zod-openapi complexity with superRefine)
- openapi.json: public, cached 1h, no auth
- MDX: single source for React pages + .md raw endpoint via rewrite
- Replay: reuses dispatchWebhook, deleted=404, disabled=409

## Open Items

- Enrich Zod schemas with .meta() descriptions (deferred to iterative improvement)
- OpenAPI spec validation with Redocly (manual, after deploy)

## Next Phase

Phase 7: REST-specific quotas + per-IP pre-auth rate limit + Sentry alerts

## Metrics

- Files created: 23
- Files modified: 4
- Lines added: ~1,400
- Commits: 1 (pending)
- Endpoints shipped: 1 replay + 1 spec + 1 .md
- Pages shipped: 5 docs pages + 1 webhooks UI
- Total v1 endpoints: 25
