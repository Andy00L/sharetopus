# Design Decisions

This document records architectural decisions visible in the codebase, explains the reasoning behind each, and notes the tradeoffs.

## 1. No ORM, Raw Supabase Client

**What was chosen:** All database access goes through the Supabase JavaScript client (`@supabase/supabase-js`). There is no ORM like Prisma, Drizzle, or Knex.

**Why it makes sense:** The Supabase client provides a query builder that maps closely to PostgreSQL operations. It avoids adding a schema file, migration tooling, and build step that an ORM would require. For a codebase of this size (27 tables, server actions as the query layer), the overhead of an ORM is not justified.

**Tradeoff:** Queries are not type-safe at the query level. The `database.types.ts` file provides table and column types (auto-generated from the Supabase schema), but nothing prevents constructing an invalid query at compile time. Typos in column names or incorrect filter logic are caught at runtime, not build time.

## 2. Two Supabase Clients (User-Scoped vs Admin)

**What was chosen:** Two separate Supabase client constructors in `src/actions/api/`:

- `supabase.ts` creates a client using the Clerk JWT. It respects Row Level Security (RLS), so users can only access their own rows.
- `adminSupabase.ts` creates a client using the service role key. It bypasses RLS entirely.

**Why it makes sense:** Most user-facing operations should be scoped to the current user. RLS enforces this at the database level, preventing accidental data leaks even if application code has a bug. But cron jobs, webhooks, and MCP _internal actions run without a user session, so they need the admin client.

**Tradeoff:** Developers must choose the right client for each context. Using adminSupabase where supabase would suffice means bypassing a security layer. Using supabase where adminSupabase is needed (for example, in a webhook handler) causes silent query failures because there is no Clerk JWT.

## 3. QStash for Scheduling Instead of In-Process Timers

**What was chosen:** Scheduled posts are stored in PostgreSQL and delivered by Upstash QStash, which sends an HTTP POST to the cron endpoint at the scheduled time.

**Why it makes sense:** Vercel serverless functions are ephemeral. In-process timers (`setTimeout`, `setInterval`, node-cron) would not survive between invocations. QStash is an external service that reliably fires HTTP requests on a schedule, regardless of server restarts or deployments.

**Tradeoff:** There is a dependency on an external service (Upstash) for a core feature. If QStash is down or delayed, scheduled posts will not publish on time. Debugging delivery issues requires checking QStash logs in addition to application logs.

## 4. OAuth Popup Pattern with window.opener Callback

**What was chosen:** When a user clicks a connect button (for example, ConnectLinkedInButton), the app opens a new browser window for the OAuth flow. After the callback completes, the popup signals the parent window using `window.opener` and closes itself.

**Why it makes sense:** The popup pattern avoids navigating the user away from the current page. The user's form state, selected accounts, and other UI state are preserved in the parent window. A full-page redirect would lose all of that.

**Tradeoff:** Popup blockers can prevent the window from opening. Some mobile browsers handle popups poorly. The `window.opener` communication pattern is fragile and requires careful handling of cases where the parent window has been closed or refreshed.

## 5. Per-Platform 4-Route Structure (initiate / connect / post / process)

**What was chosen:** Each social platform has exactly four API routes under `src/app/api/social/{platform}/`:

- `initiate/route.ts` - Start OAuth flow (generate authorization URL).
- `connect/route.ts` - Handle OAuth callback (exchange code, fetch profile, upsert account).
- `post/route.ts` - Direct posting endpoint.
- `process/route.ts` - Orchestrator that handles posting across multiple accounts on the platform.

**Why it makes sense:** The consistent structure makes it easy to add a new platform. Copy the four route files, implement the platform-specific logic in `src/lib/api/{platform}/`, and the new platform follows the same pattern. Each route has a single responsibility.

**Tradeoff:** Some duplication exists across platforms because each route file contains similar boilerplate (auth checks, error handling, response formatting). A shared base handler could reduce this, but would add abstraction that might be harder to debug per-platform.

## 6. MCP _internal Actions That Skip Clerk Auth

**What was chosen:** The `src/actions/server/_internal/` directory contains server actions that mirror regular server actions but use `adminSupabase` instead of the Clerk-authenticated `supabase` client. These are called exclusively by the MCP server.

**Why it makes sense:** MCP requests arrive with their own authentication (Bearer token verified by `src/lib/mcp/auth.ts`). There is no Clerk session in an MCP context. The _internal actions let the MCP server read and write data without needing to impersonate a Clerk user.

**Tradeoff:** The _internal actions bypass RLS. Any bug in MCP auth could expose data across users. The _internal directory must be carefully reviewed to ensure it is never imported from user-facing code paths.

## 7. No Global State Library

**What was chosen:** Client-side state uses only React's built-in `useState` and `useEffect`. There is no Redux, Zustand, Jotai, or other global state manager.

**Why it makes sense:** The app is primarily server-driven. Most pages fetch data via server actions and render it. The only complex client state is in SocialPostForm, which manages form inputs, selected accounts, and media uploads. This does not require cross-page state sharing.

**Tradeoff:** If the app grows to need shared client state (for example, a notification system, real-time updates, or cross-page draft persistence), a state library would need to be introduced later. For now, the simplicity is appropriate.

## 8. i18n Declared but Not Implemented

**What was chosen:** The Next.js configuration declares internationalization support, but no translation files, locale routing, or translated strings exist in the codebase. All user-facing text is hardcoded in English.

**Why it makes sense:** Declaring i18n early means the framework plumbing is in place when translations are eventually needed. It does not add runtime cost.

**Tradeoff:** The declaration without implementation could mislead contributors into thinking i18n is functional. There is no translation workflow, no string extraction, and no locale detection. Adding real i18n later will require touching every component that renders user-facing text.

## 9. Instagram Connect Button Disabled in UI

**What was chosen:** The ConnectInstagramButton component exists and is rendered, but the connect button is disabled in the UI. The backend Instagram integration (OAuth routes, posting logic in `src/lib/api/instagram/`) is fully implemented.

**Why it makes sense:** Instagram's API approval process is separate from the technical integration. The backend can be built and tested while waiting for API access approval. Disabling the button prevents users from hitting an integration that may not have production credentials yet.

**Tradeoff:** Users can see the Instagram option but cannot use it, which may cause confusion. The disabled state should include a clear explanation (tooltip or label) so users understand it is coming soon rather than broken.

---

[Back to Architecture](./README.md) | [Documentation index](../README.md) | [Project root](../../README.md)
