# RECON: Codebase Audit

Date: 2026-05-09
Branch: main
HEAD: 4661199 fix(scheduled): revert delete-on-success, filter posted from UI (FIX 16)

## Executive summary

The codebase is a Next.js 16 social media scheduler with 278 source files and 32,157 lines of TypeScript. The primary structural problem is a blurred boundary between `src/actions/` and `src/lib/api/`: both contain server-side business logic, but the split follows no consistent rule. The primary redundancy is in the 4-platform posting pipeline: processAccounts, directPostFor, scheduleFor, and route handlers are each duplicated 4 times with ~60-80% shared logic across 3,400+ lines. The most dangerous finding is that Instagram token refresh exists as dead code (never wired into `ensureValidToken`), meaning Instagram accounts silently stop working after 60 days. Three LinkedIn/Pinterest/TikTok OAuth exchange functions throw across function boundaries, violating the project's errors-as-values convention. Two files have spaces in their names, breaking standard tooling. 14 database tables exist in the schema but have zero consumers in the application code (all part of the deferred x402/wallet infrastructure).

## Repo tree (current state)

```
src/                                         (278 files)
├── actions/                                 (44 files)
│   ├── api/                                 (4 files)
│   │   ├── adminSupabase.ts
│   │   ├── qstash.ts
│   │   ├── supabase.ts
│   │   └── upstash.ts
│   ├── checkActiveSubscription.ts
│   ├── client/                              (2 files)
│   │   ├── getSignedViewUrl.ts
│   │   └── signedUrlUpload.ts
│   ├── server/                              (31 files)
│   │   ├── _internal/                       (9 files)
│   │   │   ├── contentHistoryActions/       (1 file)
│   │   │   ├── data/                        (2 files)
│   │   │   ├── scheduleActions/             (6 files)
│   │   │   └── README.md
│   │   ├── accounts/                        (2 files)
│   │   ├── authCheck.ts
│   │   ├── authCheckCronJob.ts
│   │   ├── connections/                     (1 file)
│   │   ├── contentHistoryActions/           (3 files)
│   │   ├── data/                            (4 files)
│   │   ├── ensureUserExists.ts
│   │   ├── mcp/                             (3 files)
│   │   ├── rateLimit/                       (1 file)
│   │   ├── scheduleActions/                 (6 files)
│   │   └── stripe/                          (3 files)
│   └── ui/                                  (1 file)
│       └── Theme-provider.tsx
├── app/                                     (48 files)
│   ├── (marketing)/                         (3 pages)
│   ├── (protected)/                         (15 pages/components)
│   │   ├── connections/
│   │   ├── create/ (text, image, video)
│   │   ├── integrations/ (+ components/)
│   │   ├── payment/success/
│   │   ├── posted/
│   │   ├── scheduled/
│   │   ├── studio/
│   │   └── userProfile/
│   ├── .well-known/oauth-protected-resource/ (1 file)
│   └── api/                                 (25 route files)
│       ├── auth/[clerk]/
│       ├── inngest/
│       ├── mcp/[transport]/
│       ├── media/
│       ├── social/
│       │   ├── instagram/ (connect, initiate, post, process)
│       │   ├── linkedin/  (connect, initiate, post, process)
│       │   ├── pinterest/ (connect, initiate, post, process)
│       │   └── tiktok/    (connect, initiate, post, process)
│       ├── storage/ (generate-upload-url, generate-view-url)
│       └── webhooks/ (clerk, stripe)
├── components/                              (114 files)
│   ├── core/
│   │   ├── accounts/                        (8 files)
│   │   ├── create/                          (20 files)
│   │   ├── posted/                          (4 files)
│   │   └── scheduled/                       (5 files)
│   ├── icons/                               (1 file)
│   ├── marketing-page/                      (12 files)
│   ├── sidebar/                             (7 files)
│   ├── suspense/                            (4 files)
│   ├── ui/                                  (33 files, shadcn)
│   └── (root: 6 shared components)
├── hooks/                                   (1 file)
│   └── use-mobile.ts
├── inngest/                                 (6 files)
│   ├── client.ts
│   └── functions/
│       ├── platformErrors.ts
│       ├── processSinglePost.ts
│       ├── processSinglePostHelpers.ts
│       ├── scheduledPostsTick.ts
│       └── scheduledPostsTickHelpers.ts
├── lib/                                     (76 files)
│   ├── api/                                 (39 files)
│   │   ├── ensureValidToken.ts
│   │   ├── facebook/ (1 empty file)
│   │   ├── instagram/ (data/3, post/2, processAccounts/1, schedule/1)
│   │   ├── linkedin/  (data/3, post/2, processAccounts/1, schedule/1)
│   │   ├── pinterest/ (data/5, post/4, processAccounts/1, schedule/1)
│   │   ├── tiktok/    (data/3, post/4, processAccounts/1, schedule/1)
│   │   └── twitter/ (1 empty file, 1 empty dir)
│   ├── jobs/                                (1 file)
│   │   └── runtimeConfig.ts
│   ├── mcp/                                 (29 files)
│   │   ├── audit.ts, auth.ts, context.ts, entitlement.ts, tokens.ts
│   │   ├── prompts/ (4 files)
│   │   ├── resources/ (4 files)
│   │   ├── tools/ (15 files)
│   │   └── README.md
│   ├── stripe.ts
│   ├── types/                               (7 files)
│   │   ├── database.types.ts (1772 lines)
│   │   ├── dbTypes.ts (175 lines)
│   │   ├── LinkedinProfile.ts
│   │   ├── PinterestProfile .ts (SPACE IN NAME)
│   │   ├── plans.ts
│   │   ├── SchedulePostData.ts
│   │   └── TikTokProfile.ts
│   └── utils.ts
└── middleware.ts
```

## Top-level layer map

**`src/actions/`** (44 files, 3735 lines). Contains server actions (`"use server"` and `"server-only"`), API client singletons (Supabase, QStash, Upstash), and one misplaced UI component (`Theme-provider.tsx`). The `_internal/` subfolder holds auth-free versions of schedule/data actions consumed by MCP tools and Inngest. The public wrappers in `server/scheduleActions/` add Clerk auth + rate limiting then delegate to `_internal/`. This layer also hosts `client/` functions that run in the browser (signed URL upload, signed view URL fetch), which is architecturally inconsistent with the "server" framing.

**`src/app/`** (48 files, 4936 lines). Next.js App Router pages and API routes. Marketing pages are in `(marketing)/`, protected pages in `(protected)/`. API routes handle OAuth flows for 4 platforms, webhook ingestion (Clerk, Stripe), MCP transport, storage URL generation, Inngest webhook, and a media proxy. The 16 social platform route files (4 platforms x 4 operations) contain significant duplication.

**`src/components/`** (114 files, 11585 lines). React components split into `core/` (domain-specific), `marketing-page/`, `sidebar/`, `suspense/` (skeletons), `ui/` (shadcn), and root-level shared components. Business logic lives in `core/create/action/handleSocialMediaPost/` (a `"use server"` file inside the components tree, which is unusual). The `icons/` folder has a single file with 9 inline SVG components.

**`src/lib/`** (76 files, 10825 lines). Platform API integrations (Instagram, LinkedIn, Pinterest, TikTok), MCP server implementation (tools, resources, prompts, auth, audit, entitlement), type definitions, Stripe client, runtime config, and utilities. Two empty stub files exist for Facebook and Twitter. An empty `twitter/schedule/` directory exists.

**`src/inngest/`** (6 files, 975 lines). Inngest client and two function pairs: `scheduledPostsTick` (cron dispatcher, every minute) and `processSinglePost` (fan-out worker). Helpers are in separate files for testability.

**`src/hooks/`** (1 file). Single `useIsMobile` hook (768px breakpoint).

## Findings

### F1. Instagram token refresh is dead code

**Severity:** HIGH
**Bucket:** Dead code
**Effort:** S
**Risk:** MED

**Evidence:**
- `src/lib/api/ensureValidToken.ts:59-77` switch statement handles tiktok, pinterest, linkedin. No case for instagram.
- `src/lib/api/instagram/data/refreshInstagramToken.ts` exports `refreshInstagramToken` but is never imported anywhere (grep for `refreshInstagramToken` returns only its own definition on line 10).
- Instagram tokens are long-lived (60 days). After expiry, `ensureValidToken` hits the `default` case and returns `{success: false}` with a generic "unsupported platform" error.

**Why it matters:**
Every Instagram account silently breaks after 60 days. The refresh function exists and works, but nobody calls it. Users see a vague error about "unsupported platform" instead of a clean reconnection prompt.

**Recommended action:**
1. Import `refreshInstagramToken` in `ensureValidToken.ts`.
2. Add `case "instagram":` to the switch statement.
3. Verify Instagram's refresh endpoint behavior (it extends the same token rather than issuing a new refresh_token, so `refresh_token: "null"` string storage also needs review).

**Risk and side effects:**
LOW if done standalone. The refresh function already exists. Main risk is the stored `refresh_token: "null"` string literal (see F1 note in storeContentHistory flow). Instagram refresh uses the access_token itself, not a separate refresh_token, so this may work despite the "null" string.

---

### F2. Throws across function boundaries (3 platforms)

**Severity:** HIGH
**Bucket:** Inconsistency
**Effort:** M
**Risk:** MED

**Evidence:**
- `src/lib/api/linkedin/data/exchangeLinkedInCode.ts`: 6 throw statements (lines 15, 50, 60, 67, 73, 83)
- `src/lib/api/pinterest/data/exchangePinterestCode.ts`: 6 throw statements (lines 15, 54, 64, 71, 77, 87)
- `src/lib/api/tiktok/data/exchangeTikTokCode.ts`: 6 throw statements (lines 22, 55, 65, 72, 76, 86)
- `src/lib/api/linkedin/data/getLinkedInProfile.ts`: 1 throw (line 32)
- `src/lib/api/pinterest/data/getPinterestProfile.ts`: 1 throw (line 29)
- `src/lib/api/tiktok/data/getTikTokProfile.ts`: 2 throws (lines 35, 61)
- `src/actions/server/data/getSupabaseVideoFile.ts`: 1 throw (line 72)
- Total: 23 throw sites across 7 files

Instagram's `exchangeInstagramCode.ts` correctly uses error-as-values (returns `{success, message, data?}`). The other 3 platforms throw.

**Why it matters:**
Project convention is errors-as-values. Callers (connect routes) wrap these in try-catch, but this is fragile. If a new caller forgets the try-catch, the throw crashes the request with a 500 instead of returning a structured error. The inconsistency between Instagram (correct) and the other 3 platforms (throwing) makes the codebase harder to reason about.

**Recommended action:**
Refactor `exchangeLinkedInCode`, `exchangePinterestCode`, `exchangeTikTokCode`, `getLinkedInProfile`, `getPinterestProfile`, `getTikTokProfile`, and `getSupabaseVideoFile` to return `{success, error, data?}` instead of throwing. Use Instagram's pattern as the template.

**Risk and side effects:**
MED. Every caller must be updated to check `result.success` instead of wrapping in try-catch. Callers: 4 connect routes, `ensureValidToken.ts`, `directPostForLinkedInAccounts.ts`, `directPostForPinterestAccounts.ts`.

---

### F3. Files with spaces in names

**Severity:** HIGH
**Bucket:** Naming
**Effort:** S
**Risk:** LOW

**Evidence:**
- `src/lib/types/PinterestProfile .ts` (space before `.ts`)
- `src/components/core/create/upload/ImageUpload .tsx` (space before `.tsx`)
- Confirmed via `ls -la`: both exist on disk with the space.
- Import works because the import string includes the space: `from "@/lib/types/PinterestProfile "` (verified at `src/lib/api/pinterest/data/getPinterestProfile.ts:4`).

**Why it matters:**
Shell scripts, linters, and CI tools that do not quote paths will fail silently or skip these files. The space is invisible in most editors and will confuse any developer who encounters it.

**Recommended action:**
Rename both files to remove the trailing space. Update the 2 import paths:
- `src/lib/api/pinterest/data/getPinterestProfile.ts:4`
- Any component importing `ImageUpload .tsx` (export name is `ImageUploads`, not affected)

**Migration sketch:**
```
src/lib/types/PinterestProfile .ts           -> src/lib/types/PinterestProfile.ts
src/components/core/create/upload/ImageUpload .tsx -> src/components/core/create/upload/ImageUpload.tsx
```

**Risk and side effects:**
LOW. Only 1 import references the types file by path. The component is imported by its export name, not file path.

---

### F4. Unauthenticated storage view URL endpoint

**Severity:** HIGH
**Bucket:** Structural
**Effort:** S
**Risk:** LOW

**Evidence:**
- `src/app/api/storage/generate-view-url/route.ts` contains zero auth checks (grep for `auth`, `userId`, `clerk` returns empty).
- Any unauthenticated caller can POST `{path, expiresIn}` and receive a signed Supabase storage URL for any file.
- First documented in AUDIT_REPORT.md as issue #2. Still open as of FIX 16.

**Why it matters:**
An attacker who knows or guesses a storage path can generate signed view URLs for any user's uploaded media. The path format is `{userId}/{timestamp}_{filename}`, which is partially guessable.

**Recommended action:**
Add Clerk `auth()` check. Verify the requested `path` starts with the authenticated user's ID. Match the pattern in `generate-upload-url/route.ts`.

**Risk and side effects:**
LOW. Additive change. The only callers are `getSignedViewUrl.ts` (already sends `requestUserId`) and `MediaPreview.tsx`. Both already have access to the user ID.

---

### F5. Duplicate and diverged SchedulePostData type

**Severity:** HIGH
**Bucket:** Type system
**Effort:** S
**Risk:** LOW

**Evidence:**
- `src/lib/types/dbTypes.ts:138` defines `SchedulePostData` (7 fields, uses `mediaType: MediaType`, `postOptions: PlatformOptions | null`)
- `src/lib/types/SchedulePostData.ts:4` defines `SchedulePostData` (10 fields, uses `postType: "video" | "image" | "text"`, inline postOptions object, adds `coverTimestamp`, `batch_id`, `description`)
- Both schedule action files import from `SchedulePostData.ts`, not from `dbTypes.ts`:
  - `src/actions/server/scheduleActions/schedulePost.ts:5`
  - `src/actions/server/_internal/scheduleActions/schedulePost.ts:4`
- The `dbTypes.ts` version is never imported. Zero importers.
- The two definitions have diverged: different field names (`mediaType` vs `postType`), different shapes for `postOptions`, missing fields in the dbTypes version.

**Why it matters:**
A developer reading `dbTypes.ts` will find a stale definition and may use it, getting compile errors or silent field mismatches. Two definitions of the same name in the same project is a maintenance trap.

**Recommended action:**
Delete the `SchedulePostData` interface from `src/lib/types/dbTypes.ts` (lines 138-146). Keep the one in `SchedulePostData.ts` as canonical.

**Risk and side effects:**
LOW. The dbTypes version has zero importers. Deleting it changes nothing at runtime.

---

### F6. Platform code duplication across 4 platforms

**Severity:** MEDIUM
**Bucket:** Redundancy
**Effort:** L
**Risk:** MED

**Evidence:**
- 4 processAccounts files: 705 lines total (160-197 lines each)
  - `src/lib/api/instagram/processAccounts/processInstagramAccounts.ts` (197 lines)
  - `src/lib/api/linkedin/processAccounts/processLinkedinAccounts.ts` (169 lines)
  - `src/lib/api/pinterest/processAccounts/processPinterestAccounts.ts` (179 lines)
  - `src/lib/api/tiktok/processAccounts/processTiktokAccounts.ts` (160 lines)
- 4 directPostFor files: 986 lines total (224-296 lines each)
- 4 scheduleFor files: 399 lines total (91-114 lines each)
- 4 process route handlers: 212 lines total (53 lines each, nearly identical)
- 4 post route handlers: 140 lines total (35 lines each, identical except platform name)
- 4 initiate route handlers: 564 lines total (~70% shared)
- 4 connect route handlers: 1442 lines total (~50% shared)
- Grand total: ~4,448 lines across 28 files with 60-80% shared logic

**Why it matters:**
Every cross-cutting fix (auth pattern, error format, logging change) must be applied 4 times. FIX 14 (cron-secret auth) touched all 8 process/post routes. FIX 15 (content history lineage) touched all 4 directPostFor files. Each repetition is a chance for divergence.

**Recommended action:**
Extract shared helpers without collapsing the split-endpoint pattern (which is intentional for memory isolation on Vercel). Specific targets:

1. **Post route handlers**: Extract a `createPlatformPostHandler(platformPostFn)` factory. Each route becomes 3-4 lines.
2. **Process route handlers**: Extract a `createPlatformProcessHandler(platformProcessFn)` factory. Same.
3. **directPostFor files**: Extract `directPostForAccounts(config)` with platform-specific config objects. The shared skeleton (ensureValidToken, post, storeContentHistory, storeFailedPost) is ~80% of each file.
4. **scheduleFor files**: Extract `scheduleForAccounts(config)` with per-platform postOptions mapping. These are nearly identical.
5. **initiate/connect routes**: More varied, but CSRF token, subscription check, and account limit check can be factored into middleware helpers.

**Risk and side effects:**
MED. Touches many files. Must preserve the per-endpoint memory isolation pattern. Each route must remain a separate Vercel function entry point.

---

### F7. QStash client initialized but never called

**Severity:** MEDIUM
**Bucket:** Dead code
**Effort:** S
**Risk:** LOW

**Evidence:**
- `src/actions/api/qstash.ts` exports `qstash` client (initialized with `QSTASH_TOKEN` env var).
- `grep -rn "qstash" src` returns only the definition file itself. Zero callers.
- QStash was used pre-FIX 13 for scheduled post dispatch. FIX 13 replaced it with Inngest.

**Why it matters:**
Dead dependency. The `QSTASH_TOKEN` env var is still required at startup but never used. The `@upstash/qstash` package (in package.json) is dead weight.

**Recommended action:**
Delete `src/actions/api/qstash.ts`. Remove `@upstash/qstash` from `package.json` dependencies. Remove `QSTASH_TOKEN` from `.env.example`.

**Risk and side effects:**
LOW. Zero callers. Verify no Vercel/Upstash dashboard integration depends on QStash being configured.

---

### F8. Dead types in dbTypes.ts (8 unused exports)

**Severity:** MEDIUM
**Bucket:** Dead code
**Effort:** S
**Risk:** LOW

**Evidence:**
All verified by `grep -rn "<TypeName>" src --include="*.ts" --include="*.tsx" | grep "import"` returning zero results:

| Type | Line | Importers |
|------|------|-----------|
| `ApiResponse<T>` | 170 | 0 |
| `ConnectionStatus` | 116 | 0 |
| `SocialProfile` | 99 | 0 |
| `TokenInfo` | 110 | 0 |
| `SocialAccountExtra` | 121 | 0 |
| `Wallet` | 18 | 0 |
| `AnalyticsMetric` | 14 | 0 |
| `SchedulePostData` (dbTypes version) | 138 | 0 (separate file used instead, see F5) |

`SocialAccountAccessible` (line 127) IS used internally within dbTypes.ts (by `ScheduledPost` and `ContentHistory` type extensions) but has zero external importers.

**Why it matters:**
8 exported types with zero consumers clutter the type file and mislead developers into thinking they are part of the active API surface.

**Recommended action:**
Delete the 8 unused type exports from `dbTypes.ts`. Keep `SocialAccountAccessible` since it is referenced internally.

**Risk and side effects:**
LOW. Zero importers means zero breakage.

---

### F9. Profile types scattered across 4 locations

**Severity:** MEDIUM
**Bucket:** Inconsistency
**Effort:** S
**Risk:** LOW

**Evidence:**
- `InstagramProfile`: defined in `src/lib/types/dbTypes.ts:160`, imported from there
- `LinkedInProfile`: defined in `src/lib/types/LinkedinProfile.ts`, imported from there
- `PinterestProfile`: defined in `src/lib/types/PinterestProfile .ts` (space in name), imported from there
- `TikTokProfile`: defined in `src/lib/types/TikTokProfile.ts`, imported from there

Three platforms have dedicated files. Instagram is inline in dbTypes. No consistent pattern.

**Why it matters:**
When adding a new platform or modifying a profile type, a developer must search multiple locations. The inconsistency adds friction.

**Recommended action:**
Consolidate all 4 profile types into `dbTypes.ts` (where Instagram already lives) or into a single `src/lib/types/profiles.ts` file. Delete the 3 separate files after updating imports.

**Risk and side effects:**
LOW. Each separate file has exactly 1 importer. Updating 3 import paths is trivial.

---

### F10. createSecureMediaUrlSigned is misnamed

**Severity:** MEDIUM
**Bucket:** Naming
**Effort:** S
**Risk:** LOW

**Evidence:**
- `src/actions/server/data/mediaURL.ts:8` exports `createSecureMediaUrlSigned`
- Function body: concatenates query params `?file=${filePath}&user=${userId}` onto a base URL
- No HMAC, no JWT, no cryptographic signature. The "Signed" in the name is misleading.
- Callers: `handleSocialMediaPost.ts:297`, `processSinglePostHelpers.ts:179`
- Known issue from AUDIT_REPORT.md (issue #4). Still open.

**Why it matters:**
The name implies cryptographic integrity. A developer reading the code might assume the URL is tamper-proof. It is not. The `/api/media` route that receives this URL does path validation but no signature verification.

**Recommended action:**
Rename to `buildMediaProxyUrl`. Update the 2 callers. If actual HMAC signing is desired, that is a separate FIX.

**Risk and side effects:**
LOW. 2 callers to update. Name-only change.

---

### F11. refreshInstagramToken exported but never imported

**Severity:** MEDIUM
**Bucket:** Dead code
**Effort:** S
**Risk:** LOW

**Evidence:**
- `src/lib/api/instagram/data/refreshInstagramToken.ts:10` exports `refreshInstagramToken`
- `grep -rn "refreshInstagramToken" src` returns only the file's own definition. Zero importers.
- Related to F1: this is the function that SHOULD be called by `ensureValidToken` but is not.

**Why it matters:**
The function exists and appears correct, but because it is never wired in, it is dead code. Fixing F1 will resolve this finding simultaneously.

**Recommended action:**
Fix F1 (add Instagram case to ensureValidToken). This finding resolves automatically.

---

### F12. Empty platform stubs

**Severity:** LOW
**Bucket:** Dead code
**Effort:** S
**Risk:** LOW

**Evidence:**
- `src/lib/api/facebook/facebook.ts`: 0 bytes, empty file
- `src/lib/api/twitter/twitter.ts`: 0 bytes, empty file
- `src/lib/api/twitter/schedule/`: empty directory (0 files)

**Why it matters:**
Cosmetic. These stubs imply Facebook and Twitter support is in progress, but no code exists. They add noise to directory listings and searches.

**Recommended action:**
Delete all 3 (2 files, 1 directory). If Facebook/Twitter support is planned, create them when work begins.

**Risk and side effects:**
LOW. Zero importers. Zero content.

---

### F13. ThemeProvider in actions/ui/

**Severity:** LOW
**Bucket:** Structural
**Effort:** S
**Risk:** LOW

**Evidence:**
- `src/actions/ui/Theme-provider.tsx` is a `"use client"` React component
- It is not a server action. It wraps `next-themes` ThemeProvider with route-aware forced themes.
- It lives in `src/actions/`, which is otherwise entirely server-side code.

**Why it matters:**
A component in `actions/` is confusing. New developers will look for it in `components/`.

**Recommended action:**
Move to `src/components/ui/ThemeProvider.tsx` or `src/components/ThemeProvider.tsx`. Update the 1 importer (`src/app/layout.tsx`).

**Migration sketch:**
```
src/actions/ui/Theme-provider.tsx  ->  src/components/ThemeProvider.tsx
```

**Risk and side effects:**
LOW. Single importer.

---

### F14. LinkedIn schedule file naming inconsistency

**Severity:** LOW
**Bucket:** Naming
**Effort:** S
**Risk:** LOW

**Evidence:**
- `src/lib/api/linkedin/schedule/scheduledForLinkedinAccounts.ts` (past tense "scheduled", lowercase "in")
- Other platforms:
  - `scheduleForInstagramAccounts.ts` (present tense, correct)
  - `scheduleForPinterestAccounts.ts` (present tense, correct)
  - `scheduleForTikTokAccounts.ts` (present tense, correct)
- The exported function name IS correct: `scheduleForLinkedInAccounts` (present tense, proper casing)
- Additional casing inconsistency: filenames use "Linkedin" (lowercase i) vs "LinkedIn" (capital I) inconsistently across the codebase

**Why it matters:**
Grep for `scheduleFor` misses this file. The past-tense "scheduled" prefix is misleading (it does not retrieve past schedules, it creates new ones).

**Recommended action:**
Rename file to `scheduleForLinkedInAccounts.ts`. Update the 1 importer (`processLinkedinAccounts.ts:6`).

**Risk and side effects:**
LOW. Single importer.

---

### F15. French/English mixed logging and UI strings

**Severity:** LOW
**Bucket:** Inconsistency
**Effort:** M
**Risk:** LOW

**Evidence:**
- `src/lib/api/ensureValidToken.ts`: French log messages ("Token expire ou proche de l'expiration", "Pas de refresh token disponible", etc.)
- `src/components/core/accounts/connectAccountsButton/Connect*.tsx`: French toast messages ("Processus de connexion annule", "La connexion a expire en raison d'inactivite")
- `src/components/sidebar/Site-Header.tsx:18-25`: French page names ("Cree du Contenu", "Gerez vos comptes")
- `src/components/suspense/account/Placeholders.tsx`: French labels ("Gerez vos comptes sociaux")
- `src/app/(protected)/scheduled/error.tsx:30`: French comment ("BOUTON RETRY")
- User-facing error messages in `ensureValidToken.ts` are in English (correct). Only internal log messages are French.

**Why it matters:**
Mixed languages in logs make searching and debugging harder. French UI strings will confuse non-French users if i18n is not complete.

**Recommended action:**
Standardize all log messages to English. The i18n infrastructure (`i18next`, `next-i18next`) exists in package.json but is not visibly wired into the codebase. Either complete the i18n setup or replace French strings with English.

**Risk and side effects:**
LOW. Log messages only. French UI strings in sidebar affect display but are cosmetic.

---

### F16. Typos in code

**Severity:** LOW
**Bucket:** Naming
**Effort:** S
**Risk:** LOW

**Evidence:**
- `src/actions/client/getSignedViewUrl.ts:39`: "Succesfully" (should be "Successfully")
- `src/actions/client/getSignedViewUrl.ts:43`: "Unecpected" (should be "Unexpected")
- `src/app/api/webhooks/stripe/route.ts:179`: "payement" (should be "payment")
- `src/components/renderFilePreview.tsx`: comment "collors" (should be "colors")
- `src/components/core/create/NoAccountAvaible.tsx`: filename "Avaible" (should be "Available")
- `src/components/marketing-page/details/platformList.tsx`: export "PlatformsListe" (French/English mix)

**Why it matters:**
Cosmetic, but the first 3 appear in user-visible or log-visible strings.

**Recommended action:**
Fix all 6 in a single commit.

---

### F17. Commented-out code blocks

**Severity:** LOW
**Bucket:** Dead code
**Effort:** S
**Risk:** LOW

**Evidence:**
- `src/app/(protected)/connections/page.tsx:45-51`: Instagram accounts filter (6 lines)
- `src/app/(protected)/connections/page.tsx:111-133`: Instagram section UI (23 lines)
- `src/actions/client/signedUrlUpload.ts:113,131-133`: commented console.log calls
- `src/components/sidebar/nav-create.tsx:35-49`: commented "Studio" menu item (15 lines)
- `src/components/marketing-page/testimonial.tsx:94-105`: commented social links (12 lines)
- `src/components/suspense/posted/ContentHistorySkeleton.tsx:48-52`: commented header (5 lines)

**Why it matters:**
Commented-out code adds noise. If it is needed later, git history preserves it.

**Recommended action:**
Delete all commented-out blocks. The Studio menu item can be restored from git when the Studio feature ships.

---

### F18. Empty SidebarMenuItem in nav-post

**Severity:** LOW
**Bucket:** Dead code
**Effort:** S
**Risk:** LOW

**Evidence:**
- `src/components/sidebar/nav-post.tsx:20`: `<SidebarMenuItem></SidebarMenuItem>` (empty, renders nothing)

**Why it matters:**
Renders an empty DOM element. Cosmetic, no functional impact.

**Recommended action:**
Delete line 20.

---

### F19. TikTok connect button timeout differs from other platforms

**Severity:** LOW
**Bucket:** Inconsistency
**Effort:** S
**Risk:** LOW

**Evidence:**
- `src/components/core/accounts/connectAccountsButton/ConnectTikTokButton.tsx`: 8-minute timeout (480000ms)
- Instagram, LinkedIn, Pinterest buttons: 10-minute timeout (600000ms)

**Why it matters:**
Minor UX inconsistency. If there is a reason for the shorter timeout, it should be documented.

**Recommended action:**
Standardize to 10 minutes unless TikTok OAuth has a shorter window. Extract timeout as a shared constant.

---

### F20. Em-dashes in source files

**Severity:** LOW
**Bucket:** Inconsistency
**Effort:** S
**Risk:** LOW

**Evidence:**
```
src/actions/server/ensureUserExists.ts:23
src/components/AvatarWithFallback.tsx:16
src/lib/types/database.types.ts:2,230,330,670,1370,1606,1681
```
8 occurrences total across 3 files.

**Why it matters:**
Project style rule prohibits em-dashes. These are all in comments, not in runtime strings.

**Recommended action:**
Replace with periods, commas, or parentheses.

---

### F21. 14 schema tables with zero consumers

**Severity:** INFO
**Bucket:** Deferred infrastructure
**Effort:** N/A
**Risk:** N/A

**Evidence:**
Tables defined in `supabase/migrations/20260506000001_initial_schema.sql` with zero `from("tableName")` references in src/:

| Table | Purpose |
|-------|---------|
| `wallets` | x402 wallet storage |
| `wallet_credits` | x402 balance tracking |
| `wallet_credits_ledger` | x402 transaction log |
| `x402_charges` | x402 payment records |
| `x402_refunds` | x402 refund records |
| `x402_access_log` | x402 access audit |
| `usdc_fmv_daily` | USDC fair market value |
| `pricing_actions` | x402 action pricing (seed data only) |
| `social_connections` | OAuth flow state machine |
| `mcp_oauth_clients` | MCP OAuth client registry |
| `mcp_sessions` | MCP session tracking (comment in route.ts says "read/write" but no direct query exists; may be handled by mcp-handler SDK internally) |
| `sanctions_screenings` | Wallet compliance |
| `siwe_nonces` | Sign-In-With-Ethereum nonces |
| `rate_limit_events` | Rate limit audit trail |

**Why it matters:**
These tables consume schema space and migration complexity but serve no current feature. They are reserved infrastructure for x402 wallet payments and extended MCP OAuth (Phase 4).

**Recommended action:**
Leave in place. Document as deferred infrastructure in the codebase. See "What stays" section.

---

### F22. user_id column in stripe tables

**Severity:** INFO
**Bucket:** Naming
**Effort:** N/A
**Risk:** N/A

**Evidence:**
- `stripe_subscriptions.user_id` (migration line 448)
- `stripe_invoices.user_id` (migration line 469)
- Both FK to `users(id)` with CASCADE
- Code correctly uses `.eq("user_id", userId)` (e.g., `checkActiveSubscription.ts:27`, `checkUserSubscription.ts:40`, `listBillingSummary.ts:25`)

**Why it matters:**
Per project rules, `principal_id` is the canonical user identifier. However, `stripe_subscriptions` and `stripe_invoices` FK to `users` (not `principals`), and `user_id` correctly reflects that relationship. `users.id` equals `principals.id` in practice, but the FK target is `users`, so `user_id` is the accurate column name.

**Recommended action:**
None. This is intentional and correct. The Stripe billing domain references users specifically, not the broader principals abstraction.

---

### F23. STRIPE_PUBLISHABLE_KEY in .env.example but not in source

**Severity:** INFO
**Bucket:** Dead code
**Effort:** S
**Risk:** LOW

**Evidence:**
- `.env.example` includes `STRIPE_PUBLISHABLE_KEY=pk_test_...`
- `grep -rn "STRIPE_PUBLISHABLE_KEY" src` returns zero results
- Likely consumed by the Stripe.js client SDK automatically via Next.js `NEXT_PUBLIC_` prefix convention, but it is NOT prefixed with `NEXT_PUBLIC_` in `.env.example`

**Why it matters:**
If it is not prefixed with `NEXT_PUBLIC_`, it is not exposed to the browser. If it IS needed client-side, it should be renamed. If it is NOT needed, it should be removed from `.env.example`.

**Recommended action:**
Operator decision: is this used by Stripe.js on the client? If yes, rename to `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. If no, remove from `.env.example`.

---

### F24. handleSocialMediaPost lives in components tree

**Severity:** INFO
**Bucket:** Structural
**Effort:** M
**Risk:** MED

**Evidence:**
- `src/components/core/create/action/handleSocialMediaPost/handleSocialMediaPost.ts` is a `"use server"` file (590 lines)
- It contains server-side business logic: auth checks, rate limiting, content validation, multi-platform dispatch, media cleanup
- It lives in `src/components/`, which is conventionally for React components

**Why it matters:**
Not a bug, but architecturally surprising. A 590-line server action in the components tree makes it harder to find. It is co-located with its primary consumer (SocialPostForm), which has merit, but it breaks the convention that all server actions live in `src/actions/`.

**Recommended action:**
Consider moving to `src/actions/server/handleSocialMediaPost.ts`. This is a judgment call for the operator. Co-location has value. Note: this file also imports `FRONTEND_URL` and makes HTTP calls to `/api/social/*/process`, which reinforces that it is server-side orchestration, not a component.

## Refactor plan (priority-ordered)

```
1. F1       (S)  Wire Instagram token refresh into ensureValidToken
2. F3       (S)  Rename files with spaces (PinterestProfile, ImageUpload)
3. F5, F8   (S)  Delete dead types from dbTypes.ts (SchedulePostData + 7 unused)
4. F4       (S)  Add auth check to generate-view-url route
5. F7       (S)  Delete QStash client and dependency
6. F12      (S)  Delete empty facebook/twitter stubs
7. F10      (S)  Rename createSecureMediaUrlSigned to buildMediaProxyUrl
8. F16      (S)  Fix typos (6 instances)
9. F2       (M)  Convert throws to error-as-values in 7 files
10. F6      (L)  Extract shared platform helpers (process, post, schedule, routes)
11. F9      (S)  Consolidate profile types into one location
12. F15     (M)  Standardize logging language to English
13. F13,F14 (S)  Move ThemeProvider, rename LinkedIn schedule file
14. F17-F20 (S)  Clean up commented code, empty elements, em-dashes
```

## Migration map (file-by-file)

| Current path | Destination | Reason | Note |
|---|---|---|---|
| `src/lib/types/PinterestProfile .ts` | `src/lib/types/PinterestProfile.ts` | F3 | Remove trailing space |
| `src/components/core/create/upload/ImageUpload .tsx` | `src/components/core/create/upload/ImageUpload.tsx` | F3 | Remove trailing space |
| `src/actions/api/qstash.ts` | DELETE | F7 | Zero callers since FIX 13 |
| `src/lib/api/facebook/facebook.ts` | DELETE | F12 | Empty file, 0 bytes |
| `src/lib/api/twitter/twitter.ts` | DELETE | F12 | Empty file, 0 bytes |
| `src/lib/api/twitter/schedule/` | DELETE | F12 | Empty directory |
| `src/actions/ui/Theme-provider.tsx` | `src/components/ThemeProvider.tsx` | F13 | Misplaced in actions/ |
| `src/lib/api/linkedin/schedule/scheduledForLinkedinAccounts.ts` | `src/lib/api/linkedin/schedule/scheduleForLinkedInAccounts.ts` | F14 | Fix past-tense, fix casing |

Files that receive edits (not moves):

| File | Change | Reason |
|---|---|---|
| `src/lib/api/ensureValidToken.ts` | Add Instagram case + import | F1 |
| `src/lib/types/dbTypes.ts` | Delete 8 unused type exports | F5, F8 |
| `src/app/api/storage/generate-view-url/route.ts` | Add auth check | F4 |
| `src/actions/server/data/mediaURL.ts` | Rename export | F10 |
| `src/lib/api/linkedin/data/exchangeLinkedInCode.ts` | Convert throws to returns | F2 |
| `src/lib/api/pinterest/data/exchangePinterestCode.ts` | Convert throws to returns | F2 |
| `src/lib/api/tiktok/data/exchangeTikTokCode.ts` | Convert throws to returns | F2 |
| `src/lib/api/linkedin/data/getLinkedInProfile.ts` | Convert throws to returns | F2 |
| `src/lib/api/pinterest/data/getPinterestProfile.ts` | Convert throws to returns | F2 |
| `src/lib/api/tiktok/data/getTikTokProfile.ts` | Convert throws to returns | F2 |
| `src/actions/server/data/getSupabaseVideoFile.ts` | Convert throw to return | F2 |

## What stays (deliberately)

- **Split `/api/social/{platform}/{process,post}` endpoints.** Each is a separate Vercel function entry point for memory isolation. LinkedIn video uploads for multiple accounts each get their own function instance. Do NOT collapse process + post into one endpoint.

- **`_internal` schedule/data actions vs public wrappers.** The `_internal/` versions skip Clerk auth and rate limiting. They are called by MCP tools (which do their own auth via `resolveMcpPrincipal`) and by Inngest workers (which are trusted server-side callers). The public wrappers add the web-facing auth layer. This trust boundary is deliberate.

- **`social_connections` table (empty).** Reserved for the Phase 4 x402 connection flow state machine. The migration defines a status guard trigger (`social_connections_status_guard`). No code consumes it yet.

- **`mcp_oauth_clients` table (empty).** Reserved for MCP OAuth client registration. The `mcp-handler` SDK may populate it internally; the comment in `route.ts:33` says "Tables touched: mcp_sessions". No direct queries exist in application code.

- **14 x402/wallet tables (no consumers).** All deferred infrastructure for crypto payment support (wallets, charges, refunds, credits, pricing, USDC FMV, SIWE, sanctions). The schema is mature (includes triggers, RLS policies, ledger tables) but the application layer is not built.

- **`rate_limit_events` table (no consumers).** Defined in schema with RLS policies. Application-level rate limiting uses Upstash Redis (via `checkRateLimit.ts`), not this table. The table likely exists for audit/analytics of rate limit hits, which is not yet wired.

- **`platform_quotas` table (consumed by MCP only).** Read by `bulkSchedule.ts` to enforce per-platform daily caps. Not consumed by the web UI posting flow. This is correct: MCP is the only path that needs quota enforcement.

- **`usage_quotas` table (consumed by MCP only).** Read/written via `atomic_increment_quota` RPC in `entitlement.ts`. Not consumed by web UI. Correct: MCP entitlement checks are separate from Clerk-authed web flows.

- **Fail-open quota policy in `entitlement.ts`.** If the `atomic_increment_quota` RPC errors, the tool call is ALLOWED (not blocked). This is deliberate: a transient database error should not block paying users. The tradeoff is briefly allowing over-quota calls during DB issues.

## Dead code inventory

### Unused exports

```
- src/lib/types/dbTypes.ts:170  export interface ApiResponse<T>        (0 importers)
- src/lib/types/dbTypes.ts:116  export interface ConnectionStatus      (0 importers)
- src/lib/types/dbTypes.ts:99   export interface SocialProfile         (0 importers)
- src/lib/types/dbTypes.ts:110  export interface TokenInfo             (0 importers)
- src/lib/types/dbTypes.ts:121  export interface SocialAccountExtra    (0 importers)
- src/lib/types/dbTypes.ts:18   export type Wallet                    (0 importers)
- src/lib/types/dbTypes.ts:14   export type AnalyticsMetric            (0 importers)
- src/lib/types/dbTypes.ts:138  export interface SchedulePostData      (0 importers; separate file used)
- src/lib/api/instagram/data/refreshInstagramToken.ts:10  export default refreshInstagramToken  (0 importers; see F1)
- src/actions/api/qstash.ts:3   export const qstash                   (0 importers; see F7)
```

### Unused files

```
- src/lib/api/facebook/facebook.ts       (0 bytes, empty)
- src/lib/api/twitter/twitter.ts         (0 bytes, empty)
- src/lib/api/twitter/schedule/          (empty directory)
```

### Unused parameters

```
- src/lib/api/instagram/post/postToInstagram.ts:49-50  params mediaType, fileName declared in type but never destructured from params object
```

### Commented-out code blocks > 2 lines

```
- src/app/(protected)/connections/page.tsx:45-51        Instagram accounts filter (6 lines)
- src/app/(protected)/connections/page.tsx:111-133       Instagram section UI (23 lines)
- src/components/sidebar/nav-create.tsx:35-49            Studio menu item (15 lines)
- src/components/marketing-page/testimonial.tsx:94-105   Social links (12 lines)
- src/components/suspense/posted/ContentHistorySkeleton.tsx:48-52  Header section (5 lines)
```

### Dead env vars

```
- QSTASH_TOKEN: referenced in src/actions/api/qstash.ts but qstash client has 0 callers
- STRIPE_PUBLISHABLE_KEY: in .env.example but 0 references in src/ (see F23)
```

### Dead directories

```
- src/lib/api/twitter/schedule/  (empty directory, 0 files)
```

## Type system audit

### Generated vs manual

- **Generated**: `src/lib/types/database.types.ts` (1772 lines). Comment says "mirrors the schema in supabase/migrations/", regenerable via `supabase gen types`. Defines `Database`, `Json`, table Row/Insert/Update types, enums, relationships, and convenience aliases at the bottom (lines 1606-1772).
- **Manual**: `src/lib/types/dbTypes.ts` (175 lines). Re-exports `Json` from generated file. Defines domain aliases (`User`, `SocialAccount`, etc.), enum types (`Platform`, `PostStatus`, `MediaType`), platform option interfaces, and helper interfaces.
- **Manual**: `src/lib/types/plans.ts` (294 lines). Plan pricing, tier ranking, price-to-tier mapping.
- **Manual**: `src/lib/types/SchedulePostData.ts` (28 lines). Schedule post input shape.
- **Manual**: `src/lib/types/LinkedinProfile.ts` (12 lines). LinkedIn profile interface.
- **Manual**: `src/lib/types/PinterestProfile .ts` (14 lines, space in name). Pinterest profile interface.
- **Manual**: `src/lib/types/TikTokProfile.ts` (47 lines). TikTok profile interface.

### Duplicates

1. **SchedulePostData**: defined in both `dbTypes.ts:138` and `SchedulePostData.ts:4`. Shapes have diverged:
   - `dbTypes.ts` version: 7 fields, uses `mediaType: MediaType`, `postOptions: PlatformOptions | null`
   - `SchedulePostData.ts` version: 10 fields, uses `postType: "video"|"image"|"text"`, inline postOptions, adds `coverTimestamp`, `batch_id`, `description`
   - Only the `SchedulePostData.ts` version is imported (by 2 files). The `dbTypes.ts` version is dead.

2. **Convenience types at bottom of database.types.ts**: lines 1606-1772 define `Tables<T>`, `TablesInsert<T>`, `TablesUpdate<T>`, `Enums<T>`, plus table-specific aliases like `Principal`, `SocialAccount`, `ScheduledPost`, etc. Some of these overlap with `dbTypes.ts` (e.g., both define a `SocialAccount` type). The `database.types.ts` versions use `Tables<"social_accounts">` directly; the `dbTypes.ts` versions also use `Tables<"social_accounts">` but add join-result extensions.

### Shadows

- `dbTypes.ts` `SocialAccount` = `Tables<"social_accounts">` (exact alias, no extension). This shadows the same alias at `database.types.ts:1749`.
- `dbTypes.ts` `ScheduledPost` = `Tables<"scheduled_posts"> & { social_accounts?: ... }` (extends with optional join). This is NOT a shadow; it adds a field.
- `dbTypes.ts` `ContentHistory` = `Tables<"content_history"> & { social_accounts?: ... }` (extends with optional join). Same pattern.
- `dbTypes.ts` `User` = `Tables<"users">` (exact alias). Shadows `database.types.ts:1746`.

### Weak spots

- **`any` usage**: 0 instances of `: any`, `<any>`, or `as any` in source files. The 4 grep hits are false positives (word "any" in JSDoc comments like "any active subscription").
- **`@ts-expect-error` / `@ts-ignore`**: 0 instances.
- **Type assertions (`as` casts)**: Found in `src/inngest/functions/processSinglePostHelpers.ts`:
  - `post.post_options as PostOptions`
  - `options.privacyLevel ?? "PUBLIC" as PrivacyLevel`
  - `post.platform as Platform`
  - These are narrowing JSON columns to known shapes, which is acceptable when the schema guarantees the shape.
- **`unknown` not narrowed**: None found.

### Recommended consolidation

1. Delete the 8 dead exports from `dbTypes.ts` (F5, F8).
2. Move the 3 separate profile type files into `dbTypes.ts` (F9).
3. Delete the `database.types.ts` convenience aliases at lines 1746-1772 (they shadow `dbTypes.ts` and are never imported). Verify first: `grep -rn "from.*database.types.*Principal\|from.*database.types.*McpSession"` etc.

## Documentation drift

- `src/actions/client/getSignedViewUrl.ts:1` comment says `// lib/client/getSignedViewUrl.ts` (incorrect path; file is at `actions/client/`)
- `src/lib/api/ensureValidToken.ts:1` comment says `// lib/api/auth/ensureValidToken.ts` (incorrect path; file is at `lib/api/ensureValidToken.ts`, no `auth/` directory)
- `src/lib/api/ensureValidToken.ts:150` comment says "Treat parsing errors as expired" but code returns `false` (not expired). The comment contradicts the return value.
- `src/app/api/mcp/[transport]/route.ts:33` comment says "Tables touched: mcp_sessions (read/write)" but no direct mcp_sessions query exists in the file (may be handled internally by mcp-handler SDK).
- `next.config.ts:17` comment says `// LinkedIn media domain` (correct)
- `next.config.ts:22` comment says `// Supabase` but line 27 hostname `scontent-iad3-2.cdninstagram.com` also says `// Supabase` (incorrect; this is Instagram CDN)

## Open questions for the operator

1. **Instagram token refresh**: Is the missing Instagram case in `ensureValidToken` a known bug being tracked, or was it intentionally omitted because Instagram tokens are refreshed through a different path? (Evidence suggests bug: `refreshInstagramToken.ts` exists with zero callers.)

2. **Instagram UI on connections page**: Lines 45-51 and 111-133 of `connections/page.tsx` have Instagram account display commented out. Is Instagram connect still supported, or is it being hidden temporarily? (The connect button component exists and the API routes work.)

3. **STRIPE_PUBLISHABLE_KEY**: Is this consumed client-side by Stripe.js? If yes, it needs the `NEXT_PUBLIC_` prefix. If no, it should be removed from `.env.example`.

4. **mcp_sessions table**: Is this managed by the `mcp-handler` npm package internally, or should application code write to it? The route comment says "read/write" but no queries exist.

5. **Studio page**: `src/app/(protected)/studio/page.tsx` renders a `ComingSoon` component and the nav link is commented out. Is this feature planned for a specific timeline, or should the page and nav comment be removed?

6. **handleSocialMediaPost location**: Should the 590-line server action at `src/components/core/create/action/handleSocialMediaPost/handleSocialMediaPost.ts` stay co-located with SocialPostForm, or move to `src/actions/server/`?

7. **Platform daily caps**: Web UI posting bypasses `platform_quotas` enforcement (only MCP checks it via `bulkSchedule.ts`). Is this intentional, or should web UI posting also check daily caps?

## Honest limits of this audit

- Did not run the application or verify runtime behavior. All findings are from static analysis of source files, grep, and migration SQL.
- Did not benchmark Vercel function memory or cold start times. Recommendations preserve the split-endpoint pattern based on the handoff doc and inline comments.
- Did not validate Supabase RLS policies against actual Clerk JWT claims. Covered only schema and migration files.
- Did not verify whether the `mcp-handler` npm package manages `mcp_sessions` internally. The finding is listed as INFO with an open question.
- Did not audit the 33 shadcn UI component files (`src/components/ui/`). These are generated library code.
- Did not audit CSS (`globals.css`) or static assets (`public/`).
- Did not verify OAuth scopes against current platform API documentation (scopes may have changed since code was written).
- Did not diff `database.types.ts` against `supabase gen types` output. The file header says it mirrors migrations, but it may be stale if migrations were added without regenerating.
- Console.log count (674) was noted but individual calls were not audited for sensitive data exposure. The MCP audit layer (`audit.ts`) has token redaction, but platform API log calls may leak tokens in error scenarios.

## Appendix A. Raw counts

### Source file counts

```bash
$ find src -name "*.ts" | wc -l
164
$ find src -name "*.tsx" | wc -l
114
$ find src -name "*.ts" -o -name "*.tsx" | wc -l
278
$ find src -name "*.test.*" -o -name "*.spec.*" 2>/dev/null
(no output - zero test files)
```

### Line counts by directory

```bash
$ find src/actions -name "*.ts" -o -name "*.tsx" | xargs wc -l | tail -1
  3735 total
$ find src/lib/api -name "*.ts" | xargs wc -l | tail -1
  5612 total
$ find src/lib/mcp -name "*.ts" | xargs wc -l | tail -1
  2888 total
$ find src/inngest -name "*.ts" | xargs wc -l | tail -1
  975 total
$ find src/app -name "*.ts" -o -name "*.tsx" | xargs wc -l | tail -1
  4936 total
$ find src/components -name "*.ts" -o -name "*.tsx" | xargs wc -l | tail -1
  11585 total
$ find src/lib/types -name "*.ts" | xargs wc -l | tail -1
  2325 total
```

### Export counts

```bash
$ grep -rn "^export" src --include="*.ts" --include="*.tsx" | wc -l
441
$ grep -rn "^export type\|^export interface" src --include="*.ts" | wc -l
121
$ grep -rn "^export function\|^export async function\|^export const\|^export class\|^export default" src --include="*.ts" --include="*.tsx" | wc -l
284
```

### Environment variable reads

```bash
$ grep -roh "process\.env\.\w*" src --include="*.ts" --include="*.tsx" | sort -u
process.env.CLERK_WEBHOOK_SECRET
process.env.CLERK_WEBHOOK_SECRET_DEV
process.env.CRON_SECRET_KEY
process.env.FRONTEND_URL
process.env.INSTAGRAM_CLIENT_ID
process.env.INSTAGRAM_CLIENT_SECRET
process.env.INSTAGRAM_REDIRECT_URL
process.env.LINKEDIN_CLIENT_ID
process.env.LINKEDIN_CLIENT_SECRET
process.env.LINKEDIN_REDIRECT_URL
process.env.NEXT_PUBLIC_BASE_URL
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
process.env.NEXT_PUBLIC_SUPABASE_URL
process.env.NODE_ENV
process.env.PINTEREST_CLIENT_ID
process.env.PINTEREST_CLIENT_SECRET
process.env.PINTEREST_REDIRECT_URL
process.env.QSTASH_TOKEN
process.env.STRIPE_SECRET_KEY
process.env.STRIPE_WEBHOOK_SECRET
process.env.STRIPE_WEBHOOK_SECRET_DEV
process.env.SUPABASE_SERVICE_ROLE
process.env.TIKTOK_CLIENT_KEY
process.env.TIKTOK_CLIENT_KEY_DEV
process.env.TIKTOK_CLIENT_SECRET
process.env.TIKTOK_CLIENT_SECRET_DEV
process.env.TIKTOK_REDIRECT_URL
process.env.UPSTASH_REDIS_REST_TOKEN
process.env.UPSTASH_REDIS_REST_URL
```

### External call counts

```bash
$ grep -rn "fetch(" src --include="*.ts" --include="*.tsx" | wc -l
47
$ grep -rn "adminSupabase" src --include="*.ts" --include="*.tsx" | wc -l
143
```

### Type system

```bash
$ wc -l src/lib/types/database.types.ts src/lib/types/dbTypes.ts
 1772 src/lib/types/database.types.ts
  175 src/lib/types/dbTypes.ts
 1947 total
```

### any / ts-ignore

```bash
$ grep -rn ": any\b\|<any>\|as any\b" src --include="*.ts" --include="*.tsx"
src/lib/mcp/tools/listBillingSummary.ts:51: * Plan gate: any active subscription.
src/lib/mcp/tools/listConnections.ts:11: * Plan gate: any active subscription.
src/lib/mcp/tools/listContentHistory.ts:11: * Plan gate: any active subscription.
src/lib/mcp/tools/listScheduledPosts.ts:11: * Plan gate: any active subscription.
(all false positives - word "any" in JSDoc, not type annotations)

$ grep -rn "@ts-expect-error\|@ts-ignore" src --include="*.ts" --include="*.tsx"
(no output - zero instances)
```

### TODO / FIXME / HACK

```bash
$ grep -rn "TODO\|FIXME\|HACK\|XXX" src --include="*.ts" --include="*.tsx"
(no output - zero instances)
```

### Console statements

```bash
$ grep -rn "console\.log\|console\.warn\|console\.error" src --include="*.ts" --include="*.tsx" | wc -l
674
```

### Platform duplication

```bash
$ wc -l src/lib/api/*/processAccounts/*.ts
  197 src/lib/api/instagram/processAccounts/processInstagramAccounts.ts
  169 src/lib/api/linkedin/processAccounts/processLinkedinAccounts.ts
  179 src/lib/api/pinterest/processAccounts/processPinterestAccounts.ts
  160 src/lib/api/tiktok/processAccounts/processTiktokAccounts.ts
  705 total

$ wc -l src/lib/api/*/post/directPostFor*.ts
  234 src/lib/api/instagram/post/directPostForInstagramAccounts.ts
  296 src/lib/api/linkedin/post/directPostForLinkedInAccounts.ts
  232 src/lib/api/pinterest/post/directPostForPinterestAccounts.ts
  224 src/lib/api/tiktok/post/directPostForTikTokAccounts.ts
  986 total

$ wc -l src/lib/api/*/schedule/schedule*.ts src/lib/api/linkedin/schedule/scheduled*.ts
   91 src/lib/api/instagram/schedule/scheduleForInstagramAccounts.ts
  100 src/lib/api/linkedin/schedule/scheduledForLinkedinAccounts.ts
  114 src/lib/api/pinterest/schedule/scheduleForPinterestAccounts.ts
   94 src/lib/api/tiktok/schedule/scheduleForTikTokAccounts.ts
  399 total

$ wc -l src/app/api/social/*/process/route.ts
  53 src/app/api/social/instagram/process/route.ts
  53 src/app/api/social/linkedin/process/route.ts
  53 src/app/api/social/pinterest/process/route.ts
  53 src/app/api/social/tiktok/process/route.ts
 212 total

$ wc -l src/app/api/social/*/post/route.ts
  35 src/app/api/social/instagram/post/route.ts
  35 src/app/api/social/linkedin/post/route.ts
  35 src/app/api/social/pinterest/post/route.ts
  35 src/app/api/social/tiktok/post/route.ts
 140 total
```

### Signed URL paths

```bash
$ grep -rn "createSignedUrl\|createSignedUploadUrl\|getSignedViewUrl\|createSecureMediaUrlSigned" src --include="*.ts" --include="*.tsx"
src/actions/client/getSignedViewUrl.ts:1:// lib/client/getSignedViewUrl.ts
src/actions/client/getSignedViewUrl.ts:9:export async function getSignedViewUrl(
src/actions/server/data/mediaURL.ts:8:export function createSecureMediaUrlSigned(
src/app/api/media/route.ts:40:      .createSignedUrl(filePath, 600);
src/app/api/storage/generate-upload-url/route.ts:168:      .createSignedUploadUrl(filePath);
src/app/api/storage/generate-view-url/route.ts:20:      .createSignedUrl(path, expiresIn);
src/components/core/create/action/handleSocialMediaPost/handleSocialMediaPost.ts:3:import { getSignedViewUrl }
src/components/core/create/action/handleSocialMediaPost/handleSocialMediaPost.ts:7:import { createSecureMediaUrlSigned }
src/components/core/create/action/handleSocialMediaPost/handleSocialMediaPost.ts:297:      tiktokMediaUrl = createSecureMediaUrlSigned(mediaPath, userId!);
src/components/core/create/action/handleSocialMediaPost/handleSocialMediaPost.ts:316:      const signedUrlResult = await getSignedViewUrl(
src/components/core/scheduled/MediaPreview.tsx:4:import { getSignedViewUrl }
src/inngest/functions/processSinglePostHelpers.ts:3:import { getSignedViewUrl }
src/inngest/functions/processSinglePostHelpers.ts:4:import { createSecureMediaUrlSigned }
```

### Tables in schema vs code

```bash
$ # Tables in schema NOT referenced in code:
mcp_oauth_clients
mcp_sessions
pricing_actions
rate_limit_events
sanctions_screenings
siwe_nonces
social_connections
usdc_fmv_daily
wallet_credits
wallet_credits_ledger
wallets
x402_access_log
x402_charges
x402_refunds

$ # Tables referenced in code:
analytics_metrics
api_keys
content_history
failed_posts
mcp_audit_log
platform_quotas
principals
scheduled_posts
social_accounts
stripe_invoices
stripe_subscriptions
usage_quotas
users
```

### Auth layers

```bash
$ grep -rn "authCheck\|authCheckCronJob" src --include="*.ts" | wc -l
40

$ grep -rn "extractPrincipal\|resolveMcpPrincipal" src --include="*.ts" | wc -l
43

$ # Three auth modes:
# 1. Clerk session (web): authCheck() - 25+ call sites
# 2. Cron secret (server-to-server): authCheckCronJob() - 4 call sites
# 3. MCP principal (api-key or oauth): resolveMcpPrincipal() - 1 call site (route.ts), extractPrincipal() - 15+ call sites in tools/resources
```

### Em-dashes in source

```bash
$ grep -rn $'\xe2\x80\x94' src --include="*.ts" --include="*.tsx"
src/actions/server/ensureUserExists.ts:23
src/components/AvatarWithFallback.tsx:16
src/lib/types/database.types.ts:2
src/lib/types/database.types.ts:230
src/lib/types/database.types.ts:330
src/lib/types/database.types.ts:670
src/lib/types/database.types.ts:1370
src/lib/types/database.types.ts:1606
src/lib/types/database.types.ts:1681
```
