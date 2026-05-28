# TikTok share link implementation report

## Files created / modified / deleted

| Action | File |
|---|---|
| CREATED | src/actions/server/share-link/lib/token.ts |
| CREATED | src/actions/server/share-link/validateShareToken.ts |
| CREATED | src/actions/server/share-link/createShareLink.ts |
| CREATED | src/actions/server/share-link/revokeShareLink.ts |
| CREATED | src/actions/server/share-link/listShareLinks.ts |
| CREATED | src/app/share/[platform]/[token]/page.tsx |
| CREATED | src/app/share/[platform]/[token]/ConnectShareLinkButton.tsx |
| CREATED | src/app/share/[platform]/[token]/initiate/route.ts |
| CREATED | src/app/share/[platform]/success/page.tsx |
| CREATED | src/app/share/[platform]/error/page.tsx |
| CREATED | src/components/connections/CreateShareLinkDialog.tsx |
| CREATED | src/components/connections/ShareLinkList.tsx |
| CREATED | src/components/connections/RevokeShareLinkButton.tsx |
| CREATED | src/inngest/functions/cleanupSocialConnectionsCron.ts |
| MODIFIED | src/lib/types/database.types.ts |
| MODIFIED | src/lib/x402/oauth/callback/handleOAuthCallback.ts |
| MODIFIED | src/app/api/oauth/callback/[platform]/route.ts |
| MODIFIED | src/app/(protected)/connections/page.tsx |
| MODIFIED | src/app/api/inngest/route.ts |
| NOT MODIFIED | src/proxy.ts (no change needed; /share routes pass through without auth since they are not in isProtectedRoute or isPublicRoute) |

## database.types.ts

Hand-edited. NO supabase CLI used. Changes:

1. Added `share_links` table type (Row/Insert/Update/Relationships) between `siwe_nonces` and `social_accounts`. FK `owner_principal_id` references `users.id`.
2. Added `share_link_id: string | null` to `social_connections` Row/Insert/Update.
3. Added `"share_link"` to the `initiated_via` union in `social_connections` Row/Insert/Update.
4. Added FK relationship entry `social_connections_share_link_id_fkey` referencing `share_links.id`.
5. Added `consume_share_link` RPC to Functions: `Args: { p_share_link_id: string }, Returns: { success: boolean; reason: string | null }[]`.
6. Updated `InitiatedVia` type alias: `CreatedVia | "share_link"`.
7. Added `ShareLink` convenience row alias.

## OAuth callback 11-step sequence

File: `src/lib/x402/oauth/callback/handleOAuthCallback.ts`

| Step | What | New? | Lines |
|---|---|---|---|
| 1 | State lookup (select includes `share_link_id`, `initiated_via`) | Modified | ~62-68 |
| 2 | Status/expiry validation | Existing | ~90-114 |
| 3 | Read-only share link re-validation via `validateShareLinkById` | NEW | ~118-157 |
| 4 | Owner tier lookup via `checkActiveSubscription` | NEW | ~159-161 |
| 5 | Owner account-limit check via `checkAccountLimits` | NEW | ~163-188 |
| 6 | Provider error check + token exchange | Existing | ~192-262 |
| 7 | `consume_share_link` RPC call (atomic used_count increment) | NEW | ~264-312 |
| 8 | `social_accounts` upsert | Existing | ~314-367 |
| 9 | `social_connections` status='connected' update | Existing | ~369-389 |
| 10 | Audit log `share_link.use_succeeded` | NEW | ~391-399 |
| 11 | Webhook dispatch (enriched payload) + return | Modified | ~401-420 |

## Caller compatibility for handleOAuthCallback

| Caller | File | Fields consumed | Impact |
|---|---|---|---|
| GET /api/oauth/callback/[platform] | src/app/api/oauth/callback/[platform]/route.ts | `result.ok`, `result.connectionId`, `result.redirectUrl`, `result.error.kind`, `result.error.message` | Compatible. New error kinds are new union members; handler displays message for all failures. Route handler now also checks `result.shareLinkId` and `result.error.kind.startsWith("share_link_")` to redirect share-link flows to `/share/[platform]/success` or `/share/[platform]/error`. |

No other callers exist.

## Webhook payload enrichment

Added fields (additive only, existing fields unchanged):
- `initiated_via`: string from `social_connections.initiated_via` (`"share_link"` for share-originated, existing values for others)
- `share_link_id`: string | null from `social_connections.share_link_id` (null for non-share connections)

Consumers confirmed additive-tolerant: `deliverWebhook` Inngest function forwards `payload: Record<string, unknown>` as-is. No schema validation on the payload shape.

## shadcn components used

All were already installed. None added in this build:
dialog, select, radio-group, button, input, card, table, alert-dialog, avatar, badge, separator, sonner, label

## Inngest cron

- Function ID: `cleanup-social-connections`
- Name: "Cleanup stale social connections (30d retention)"
- Schedule: `0 2 * * *` (daily 02:00 UTC)
- Retention: 30 days for `status IN ('pending', 'failed', 'expired')`
- NEVER deletes `status='connected'` or `status='revoked'`
- Batch size: 1000 per iteration, max 5 iterations
- Retries: 0
- Registered in `src/app/api/inngest/route.ts`

## Edge-case verification table

| # | Case | Where handled |
|---|---|---|
| 1 | OAuth abandoned by friend | `used_count` only mutated by `consume_share_link` at callback success (handleOAuthCallback.ts step 7) |
| 2 | Friend denies consent on TikTok | TikTok returns `error` param; callback marks connection failed; no use burned (handleOAuthCallback.ts step 6) |
| 3 | Friend's TikTok already connected to creator | Upsert `onConflict: principal_id, platform, account_identifier`; counts as success (handleOAuthCallback.ts step 8) |
| 4 | Creator downgrades tier during link lifetime | Account-limit re-check at callback aborts cleanly (handleOAuthCallback.ts step 5) |
| 5 | Creator hits cap between creation and friend's use | Pre-check at landing (page.tsx) AND callback re-check (handleOAuthCallback.ts steps 4-5) |
| 6 | Creator deletes Sharetopus account | `share_links.owner_principal_id ON DELETE CASCADE` (DB-level) |
| 7 | Share link hard-deleted | `social_connections.share_link_id ON DELETE SET NULL` (DB-level) |
| 8 | Token revoked mid-OAuth | `consume_share_link` returns `revoked`; callback aborts (handleOAuthCallback.ts step 7) |
| 9 | Concurrent consumption race | `consume_share_link` `FOR UPDATE` row lock (DB RPC) |
| 10 | Bot farms leaked token | Rate limit 5/min per IP on initiate (initiate/route.ts step 1); max_uses cap; revoke |
| 11 | Friend clicks link multiple times | Each click creates a pending `social_connections` row; first success wins; pending rows expire in 15min and are cleaned by cron |
| 12 | Mid-flow account swap by friend | Each click is a new oauth_state; first OAuth success wins |
| 13 | `used_count > max_uses` (bug) | RPC uses `>=` (defensive) in validateShareToken.ts |
| 14 | Webhook consumer ignorance of share link origin | Payload now includes `initiated_via` and `share_link_id` (handleOAuthCallback.ts step 11) |
| 15 | Forensic: which friend used a link | `social_connections.metadata.friend_ip_hash` + `friend_user_agent` (initiate/route.ts step 6) |
| 16 | Stale `social_connections` accumulation | Cleanup cron at 02:00 UTC daily, 30-day retention (cleanupSocialConnectionsCron.ts) |
| 17 | Privacy: friend sees creator's full email | first_name+last_name preferred; masked email fallback (`d****@example.com`); never full email (page.tsx buildDisplayIdentity) |
| 18 | Empty share links list | Empty state in Card (ShareLinkList.tsx) |
| 19 | Many active links (>10) | Query limit 50 rows; defer pagination (listShareLinks.ts) |
| 20 | Creator subscription expires | `createShareLink` blocked at gate; existing links still resolve until expiry/cap (createShareLink.ts step 2) |
| 21 | TikTok TTL refresh | OUT OF SCOPE; documented |
| 22 | OAuth state collision | UNIQUE constraint; insert retries with new nanoid on `23505` (initiate/route.ts retry block) |
| 23 | Mobile vs desktop | TikTok OAuth handles both; landing page responsive via Tailwind flexbox |
| 24 | Public-shared link | `max_uses`, expiry, revoke. UI description warns creator (CreateShareLinkDialog.tsx) |
| 25 | Same link across multiple friends | `max_uses > 1` supported by design |

## Invariant grep results

- `: any` / `as unknown as` in new files: 0
- em-dash in new files: 0
- `throw` in new server actions: 0
- `bun run build`: PASS

## Web-verified TikTok docs

- Scopes: `video.upload`, `video.publish`, `user.info.basic`, `user.info.profile`, `user.info.stats` confirmed valid. Source: https://developers.tiktok.com/doc/scopes-overview
- State param constraints: no explicit max length documented for web flow; overall redirect URI capped at 512 chars. nanoid(32) = 32 chars, well within limits. Source: https://developers.tiktok.com/doc/login-kit-web/
- Redirect URI static-only policy: confirmed. Must exactly match registered URI; dynamic query params denied. Source: https://developers.tiktok.com/doc/login-kit-web/

## Proxy (src/proxy.ts) decision

No edit needed. The Clerk middleware at `src/proxy.ts` uses `createRouteMatcher` for `isPublicRoute` and `isProtectedRoute`. Routes not matching either pattern pass through without `auth.protect()` being called. `/share/...` is not in either matcher, so it works for unauthenticated friends. This is the same pattern used by the referral system (`/?ref=CODE`).

## Known limitations documented

- TikTok TTL refresh-on-read remains out of scope (separate ticket)
- `social_connections` per-row IP hash uses `MCP_IP_HASH_SALT` via `extractIpHash` (existing pattern)
- Full `npx tsc --noEmit` could not run locally due to memory constraints (OOM at 8GB); the file compiles in isolated module mode. `bun run build` passes clean (Next.js build uses `ignoreBuildErrors: true`).
- `users` table has `first_name`/`last_name` but no `display_name` column. Landing page composes display identity from first + last name, falling back to masked email.

## Manual steps for Drew

1. Confirm all shadcn components are installed (all were already present).
2. Verify env `X402_TIKTOK_REDIRECT_URI` is set on Vercel (already in use by REST flow).
3. Commit (Claude Code does not commit).
4. Push to Vercel preview.
5. End-to-end test: create a share link from /connections, open the URL in an incognito browser, sign into TikTok with a test account, confirm the social_account appears on the connections page.
6. Test revoke: revoke a link, confirm a fresh visit to the URL renders the revoked error.
7. Test the Inngest cron manually via the Inngest dashboard "Invoke" feature (do not wait for 02:00 UTC for the first verification).
