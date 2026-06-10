# TikTok Content Posting API — Compliance Audit (read-only)

**Date:** 2026-05-29
**Scope:** Code-side audit of Sharetopus against TikTok's current Content Posting API + Content Sharing Guidelines.
**Method:** Source reading only. No git mutation, no SQL, no Supabase CLI, no build/tsc. Requirements re-verified against the live TikTok docs on 2026-05-29 (see §1).
**Verdict in one line:** The composer UX compliance layer that TikTok audits is **implemented and compliant** — so the rejection is most plausibly explained by *non-UX* factors: a demo/feature-flag timing gap, a requested-but-unused scope, a missing video-duration check, a privacy policy that never names TikTok, and use-case positioning.

---

## 1. Summary (blunt)

The prompt's working hypothesis — "the composer UI probably has no TikTok privacy dropdown / toggles / consent line" — **does not match the code.** As of commit `8d9538a` (2026-05-09, "feat(tiktok): Content Posting API UX compliance behind feature flag") and `0677a41` (same day, "falg true", which set the flag on), Sharetopus has a complete, TikTok-spec composition screen: `creator_info/query` is fetched client-side before submit, the creator nickname is shown, privacy is a no-default dropdown built from `privacy_level_options`, comment/duet/stitch toggles are gated by the creator's own settings, there is a commercial-content disclosure with Your-Brand/Branded-Content and the SELF_ONLY block, the exact consent declaration text is rendered before the publish button, and a media preview is shown. Requirements **R1–R7 and R9–R12 are PRESENT and compliant.**

That inverts the center of gravity. The remaining, genuinely-open rejection causes are:

1. **The compliance UX is gated behind `TIKTOK_COMPLIANCE_UI_ENABLED`, added 2026-05-09 and flipped on the same day. The in-code comment literally says "Flip to true when re-recording the TikTok demo video."** If the app/demo video TikTok reviewed was submitted before this UI existed (or the demo still shows the pre-compliance screen with hardcoded `SELF_ONLY` and no settings tab), the audit would have failed on UX it could not see — even though the code is compliant *today*. This is the single highest-leverage item and it is a process/timing question the code cannot answer.
2. **`video.upload` scope is requested but never exercised** (the app does Direct Post only). TikTok rejects apps that request scopes they don't use. **(R13, HIGH)**
3. **No video-duration check** against `max_video_post_duration_sec`; the field is fetched and then ignored. **(R8, HIGH)**
4. **The privacy policy never mentions TikTok** (it names only YouTube/Google) and is dated 05/04/2025. **(R15, rejection risk)**
5. **Use-case positioning** (post-once-share-everywhere + share-link delegation) overlaps TikTok's two named "unacceptable use" examples. **(R14, non-code)**

So: **most plausibly a combination of (a) demo/flag timing and (b) the scope + privacy-policy + positioning trio — not a missing composer UX.** Whether (a) alone explains it is undetermined from code and is the first open question for Drew.

---

## 2. Schema facts (from `src/lib/types/database.types.ts`)

Evidence base for every "the schema can/can't hold X" claim below. Quoted types are verbatim from the file.

**`social_accounts` (lines 1176–1207)** — TikTok identity for "show creator nickname":
- `platform: "linkedin" | "tiktok" | ...` — `tiktok` is in the enum (line 1182). ✓
- `display_name: string | null` (1190), `username: string | null` (1191), `avatar_url: string | null` (1193).
- `follower_count: number | null` (1195), `following_count: number | null` (1196) — populated from the `user.info.stats` scope.
- `access_token` / `refresh_token` / `token_expires_at` (1199–1201); `extra: Json` (1203).
- **There is no dedicated `nickname` column.** The UI shows the live `creator_nickname` from `creator_info` and falls back to `display_name`/`username` (TikTokSettingsTab.tsx:131).

**`scheduled_posts` (lines 979–1012)** — where a scheduled TikTok post's per-post choices must live:
- `post_title: string | null` (996), `post_description: string | null` (997).
- **`post_options: Json` (998)** — the only place TikTok privacy/interaction/brand choices can persist. There are **no** dedicated `privacy_level` / `disable_comment` / `disable_duet` / `disable_stitch` / `brand_*` columns.
- `media_type: "text" | "image" | "video"` (999), `cover_image_timestamp: number | null` (1001), `metadata: Json` (1008).
- **Finding-relevant:** the user's TikTok choices *are* persisted into `post_options` (see Reuse Inventory §5 and F-checks), so "scheduled posts have nowhere to store the privacy choice" is **NOT** a defect here — the JSON column carries it.

**`content_history` (lines 137–154)** — post-publish record:
- `platform` (143), `content_id` (144), `title`/`description` (145–146), `media_url` (147), `status` (149), **`extra: Json` (152)**. No dedicated `privacy_level`/`deep_link` columns; both would live in `extra`.

**`pending_tiktok_pulls` (lines 529–545)** — async-pull bookkeeping (intentional, see §8):
- `publish_id` (531, PK), `principal_id`, `social_account_id`, `scheduled_post_id`, `content_history_id`, `media_storage_path`, `status: "pending"|"completed"|"failed"`, `attempt_count`, `last_polled_at`, `finalized_at`, `failure_reason`, `tiktok_post_id`, `creator_username`. No privacy/interaction fields (not its job).

**`tiktok_webhook_events` (lines 1532–1545)** — `event_id`, `event_type`, `processed_at`; `Update: never` (idempotent dedupe table).

**`failed_posts` (lines 215–247)** — mirrors `scheduled_posts`: `post_options: Json` (234), `cover_image_timestamp` (237).

---

## 3. Requirement coverage matrix (R1–R15)

Live-doc re-verification (2026-05-29): the Content Sharing Guidelines confirm R2–R7 verbatim (no-default privacy, greyed interaction toggles, commercial disclosure with ≥1 selection + branded-content-not-private, the two exact consent strings, "should display a preview"). The Get-Started doc confirms **`video.publish`** is the Direct Post scope and **does not mention a distinct `video.upload` scope** — material to R13. No drift found in R2–R7; one clarification on R13 (below).

| Req | Requirement (short) | Status | Evidence (`file:line`) | Severity |
|-----|---------------------|--------|------------------------|----------|
| R1 | creator_info renders the UI pre-send | **PRESENT** | `useTikTokCreatorInfo.ts:21-40` → `getTikTokCreatorInfoForAccount.ts:26-69` → `getTikTokCreatorInfo.ts:44-45`; wired at `SocialPostForm.tsx:109-112,560-568` | — |
| R2 | Creator nickname displayed | **PRESENT** | `TikTokSettingsTab.tsx:131` | — |
| R3 | Privacy dropdown from `privacy_level_options`, no default, mandatory | **PRESENT** (UI) | options `TikTokSettingsTab.tsx:78-84,184`; no default `:175` + `defaults.ts:17-26`; gate `checkFormSubmission.ts:188-194` | — |
| R4 | Comment/Duet/Stitch toggles, greyed if disabled, none default-on, photo=comment only | **PRESENT** | UI `TikTokSettingsTab.tsx:220-294`; greying `:87-89,229,253,277`; defaults off `defaults.ts:19-21`; API `postVideo.ts:67-69`, `postImage.ts:44` | — |
| R5 | Commercial disclosure (off-default; Your Brand/Branded; ≥1; Branded≠private) | **PRESENT** | UI `TikTokSettingsTab.tsx:300-347`; SELF_ONLY block `:185-186,99-107`; gates `checkFormSubmission.ts:196-223`; API `postVideo.ts:71-72`, `postImage.ts:46-47` | — |
| R6 | Consent declaration before publish (+ Branded Content Policy variant) | **PRESENT** | `SchedulingPanel.tsx:143-169`; branded variant `:54-56` | — |
| R7 | Content preview | **PRESENT** | `SchedulingPanel.tsx:59-73` (`FilePreview`) | — |
| R8 | Video duration check vs `max_video_post_duration_sec` | **ABSENT** | field fetched `getTikTokCreatorInfo.ts:14`, `postToTikTok.ts:34`; **never compared** anywhere; `checkFormSubmission.ts:122-133` checks size only | **HIGH** |
| R9 | No watermark/branding; preset text editable | **PRESENT** | `convertPngToJpeg.ts:42-46` (white-flatten only, no branding); bodies carry only user text `postVideo.ts:65`, `postImage.ts:41-42`; caption editable `SocialPostForm.tsx:459-474` | — |
| R10 | Title ≤2,200 chars, editable | **PRESENT** | cap `captionLimits.ts:8` (2200); enforced `SocialPostForm.tsx:471`; editable `:459-474` | LOW (photo title/desc edge — see F8) |
| R11 | `TIKTOK_CLIENT_SECRET` server-only | **PRESENT** | `refreshTikTokToken.ts:17-18`, `exchangeTikTokCode.ts:19-20`, `x402/oauth/callback/tiktokTokenExchange.ts:36-37`, `webhooks/tiktok/publish/route.ts:21-23` — all server; no client-component refs | — |
| R12 | Explicit consent gates the upload | **PRESENT** | order in `SocialPostForm.tsx:232-318` (validate→upload→post); TikTok send only at `directPostForAccountsGeneric.ts:161-179` | — |
| R13 | Scopes match usage | **PARTIAL** | string `buildOAuthUrl.ts:89` + `initiate/route.ts:90`; basic/profile/stats used `getTikTokProfile.ts:12`; publish used; **`video.upload` unused** (Direct Post only — `postImage.ts:54`, no inbox/MEDIA_UPLOAD) | **HIGH** |
| R14 | Use-case positioning (non-code) | **FINDING** | share-link delegation (`share_links` table `database.types.ts:1127`); cross-platform fan-out `handleSocialMediaPost.ts:95-309` | (non-code) |
| R15 | Privacy policy names TikTok (non-code) | **PARTIAL** | exists `(marketing)/PrivacyPolicy/page.tsx`; mentions YouTube/Google only (`:86-128,166`), **not TikTok**; dated 05/04/2025 (`:15`) | (non-code, HIGH risk) |

---

## 4. Findings detail (severity-ordered)

### F1 — Compliance UX is behind a feature flag added 2026-05-09; demo likely predates it
**Severity:** HIGH (process/timing, not a code defect)
**Requirement:** R1–R7 (their *visibility at audit time*)
**Where it is now:** `src/components/core/create/SocialPostForm/state/defaults.ts:4-12`
```
// Master switch for TikTok Content Posting API compliance UX.
// ...
// Flip to true when re-recording the TikTok demo video.
// See change/REPORT.md "FIX TIKTOK-COMPLIANCE" entry.
export const TIKTOK_COMPLIANCE_UI_ENABLED = true;
```
Git: `8d9538a 2026-05-09 feat(tiktok): Content Posting API UX compliance behind feature flag`, then `0677a41 2026-05-09 falg true`. Today is 2026-05-29.
**Why it matters:** TikTok audits the screen the creator sees, typically via a submitted demo recording. The flag's own comment ties "true" to *re-recording the demo*. If the reviewed submission predates 2026-05-09 or the demo still shows the pre-compliance screen (hardcoded `SELF_ONLY`, no TikTok tab — the `else` branch at `defaults.ts:27-32`), the rejection is explained by UX TikTok never saw, despite the code being compliant now.
**Where a fix would live:** Not a code change — confirm the live deployment has the flag on (it is, in `main`) and **re-record the demo against the current composer**. `change/REPORT.md` referenced at `defaults.ts:11` is **not present in the repo** (see Open Questions).
**Blast radius:** None in code. Affects what is submitted to TikTok.

### F2 — `video.upload` scope requested but never used
**Severity:** HIGH
**Requirement:** R13
**Where it is now:** `src/lib/x402/connect/buildOAuthUrl.ts:88-89` and `src/app/api/social/tiktok/initiate/route.ts:89-90`
```
const scopes =
  "user.info.basic,user.info.profile,video.publish,video.upload,user.info.stats";
```
The publish path is **Direct Post only**: photos use `post_mode: "DIRECT_POST"` (`postImage.ts:54`); video uses `video/init` with `source: "PULL_FROM_URL"` (`postVideo.ts:75-78`). There is **no** inbox/`MEDIA_UPLOAD` upload-to-draft path anywhere (the only `inbox` references are in the *webhook* event handler `processTikTokPublishWebhook.ts:65,117`, which merely ignores `inbox_delivered` events).
**Why it fails:** Live Get-Started doc (2026-05-29) lists **`video.publish`** as the Direct Post scope and does not mention `video.upload`. `video.upload` is the upload-to-inbox/draft scope, which this app does not use. R13: "TikTok rejects apps that request scopes they do not use."
**Where a fix would live:** the two scope strings above (`buildOAuthUrl.ts:89`, `initiate/route.ts:90`). Also confirm/remove `video.upload` in the TikTok developer dashboard app config.
**Blast radius:** OAuth URL builders only; both must change together. No DB columns. Caveat in Open Questions: confirm against the dashboard, since some Direct-Post app configs historically auto-include `video.upload`.

### F3 — No video-duration check against `max_video_post_duration_sec`
**Severity:** HIGH
**Requirement:** R8
**Where it is now:** the value is fetched into `CreatorInfoData` (`getTikTokCreatorInfo.ts:14`) and `CreatorInfoResponse` (`postToTikTok.ts:34`) and then **never read**. Client validation checks only file *size*:
```
// checkFormSubmission.ts:122-133 — video branch checks selectedFile.size only
```
`postVideo.ts` initializes the post with no duration guard.
**Why it fails:** R8 requires verifying the video's duration ≤ the creator's `max_video_post_duration_sec` *before* upload. A too-long video is only rejected by TikTok after the pull, surfacing as a generic init error.
**Where a fix would live:** client-side in `checkFormSubmission.ts` (it already receives the equivalent of creator info via the composer) or in `VideoCoverSelector`/`VideoUpload` where the `<video>` element's `duration` is already available; the limit is already in `useTikTokCreatorInfo` state (`creatorInfo[account.id].max_video_post_duration_sec`). Wire that existing value into a new guard branch — do not add a second creator_info fetch.
**Blast radius:** `checkFormSubmission.ts` signature (add the per-account limit, already loaded in `SocialPostForm`), and the video-select handlers. No DB columns.

### F4 — API-layer privacy fallback is `PUBLIC_TO_EVERYONE`, and programmatic schedule paths don't enforce a privacy selection
**Severity:** MEDIUM
**Requirement:** R3 (robustness, non-UI paths)
**Where it is now:**
```
// postVideo.ts:66  /  postImage.ts:43
privacy_level: tikTokOptions?.privacyLevel || "PUBLIC_TO_EVERYONE",
```
```
// processSinglePostHelpers.ts:323-324  (scheduled worker reconstruct)
privacyLevel: (options.privacyLevel ?? "PUBLIC_TO_EVERYONE") as PrivacyLevel,
```
`schedulePostBatch.validatePostFields` (`schedulePostBatch.ts:342-383`) validates Pinterest board presence but has **no TikTok privacy check**.
**Why it matters:** The audited web path is safe — `checkFormSubmission.ts:188-194` blocks submit without a privacy choice. But MCP/x402/REST schedulers (which call `schedulePostBatch` directly) can persist a TikTok post with empty `post_options`; at publish the worker + body fall back to **public**, i.e., a post with no user-selected privacy goes out PUBLIC. This is the opposite of TikTok's "no default" intent and worse than the legacy `SELF_ONLY`.
**Where a fix would live:** add a TikTok privacy-required branch in `schedulePostBatch.validatePostFields` (mirroring the Pinterest-board check) and/or make the fallback fail-closed instead of `PUBLIC_TO_EVERYONE` in `postVideo.ts:66`/`postImage.ts:43`. Reuse the existing `TikTokOptions` shape.
**Blast radius:** `schedulePostBatch.ts` validation; the two body builders; affects MCP `schedulePost`, x402 `scheduled-posts`, REST `v1/posts` schedule paths (all already route through `schedulePostBatch`).

### F5 — creator_info re-query at publish is used only for the username, not to re-validate the user's choices
**Severity:** MEDIUM
**Requirement:** R3/R4 robustness (settings-changed-between-query-and-publish edge)
**Where it is now:** `postToTikTok.ts:91-117` re-queries `creator_info` server-side at publish, but the result is consumed only for `creator_username` (`postVideo.ts:106,111`; `postImage.ts:82,87`). It is not compared against the user's chosen `privacy_level` / interaction flags / duration.
**Why it matters:** If the creator changed their account privacy or interaction settings between composer render and publish, the chosen option may no longer be allowed; TikTok rejects the init and it surfaces as a generic "Failed to initialize" (`postVideo.ts:83-94`). Not a hard requirement, but a robustness gap on the exact path TikTok scrutinizes.
**Where a fix would live:** in `postToTikTok` after the re-query, validate `tikTokOptions.privacyLevel ∈ creatorInfo.data.privacy_level_options` (and clamp interaction flags) before calling the handlers. The data is already in hand — no new fetch.
**Blast radius:** `postToTikTok.ts` only.

### F6 — creator_info 6-req/min risk under multi-account posting
**Severity:** MEDIUM (low likelihood)
**Requirement:** R1 (rate-limit edge)
**Where it is now:** the UI hook fetches once per selected account via a dedupe set (`useTikTokCreatorInfo.ts:19,25-26`) — good. But each publish *also* re-queries per account (`postToTikTok.ts:91`). Posting to N TikTok accounts ⇒ N (UI) + N (publish) calls; selecting >6 accounts, or rapid re-selection plus publish, can approach the documented 6/min/token ceiling.
**Why it matters:** future UX changes that re-query on every render/keystroke would blow the limit; even today, large multi-account fan-out can hit it, surfacing as creator_info failures (`getTikTokCreatorInfo.ts:55-65`).
**Where a fix would live:** keep the existing `fetchedRef` dedupe; consider caching the publish-time creator_info or reusing the UI's fetched value. No change needed today — note for whoever evolves the UI.
**Blast radius:** `useTikTokCreatorInfo.ts`, `postToTikTok.ts`.

### F7 — `content_history.extra.privacy_level` stores the whole options object, not the privacy level
**Severity:** LOW
**Requirement:** R3 record-keeping
**Where it is now:** `directPostForTikTokAccounts.ts:90-95`
```
extra: {
  ...
  privacy_level: pt.config.platformOptions.tiktok,   // entire TikTokOptions object
},
```
**Why it matters:** the post-publish audit trail records a misnamed, wrong-shaped value (the full options blob under a key named `privacy_level`). Harmless to publishing, but misleading for any later compliance review or analytics.
**Where a fix would live:** `directPostForTikTokAccounts.ts:94` — record `platformOptions.tiktok?.privacyLevel` (and optionally the rest under a `tiktok_options` key). No schema change (`extra` is `Json`).
**Blast radius:** one field in the `content_history` write.

### F8 — Photo title/description limits not separately enforced; shared 2,200 cap only
**Severity:** LOW
**Requirement:** R10 (photo edge)
**Where it is now:** `postImage.ts:41-42` sends separate `title` and `description`, but the composer feeds only the single description field (capped 2,200 — `SocialPostForm.tsx:471`); for video the same field becomes the `title` (`postVideo.ts:65`).
**Why it matters:** TikTok photo posts cap title at ~90 chars and description higher; the app does not distinguish, though 2,200 is within video-title limits. Low risk; flagged for completeness.
**Where a fix would live:** `captionLimits.ts` + the photo branch of the composer if per-field caps are desired. No schema change.
**Blast radius:** composer + `postImage` title source.

### F9 — Misleading "FILE_UPLOAD" comments on a PULL_FROM_URL path
**Severity:** LOW
**Requirement:** code clarity on the compliance path
**Where it is now:** `postVideo.ts:30` ("using FILE_UPLOAD method") and `postToTikTok.ts:131` ("we'll use FILE_UPLOAD as specified") — but the actual `source` is `PULL_FROM_URL` (`postVideo.ts:76`). Also the `TikTokOptions.brandContentToggle` field (the *commercial master switch*, `dbTypes.ts:78`) is one keystroke from TikTok's API field `brand_content_toggle` (which is actually derived from `brandedContent`, `postVideo.ts:71`) — a naming trap for a future fixer.
**Why it matters:** stale comments + colliding names raise the risk of a wrong "fix" mis-wiring brand toggles.
**Where a fix would live:** comments in `postVideo.ts`/`postToTikTok.ts`; optional rename of `brandContentToggle`. No behavior change.
**Blast radius:** comments / a type field name (would touch `dbTypes.ts`, `TikTokSettingsTab.tsx`, `checkFormSubmission.ts`, `processSinglePostHelpers.ts` if renamed).

### F10 — `isTokenExpired` returns "not expired" when `token_expires_at` is null
**Severity:** LOW
**Requirement:** R1 token/reauth edge
**Where it is now:** `ensureValidToken.ts:136-140`
```
if (!expiresAt) {
  console.log("[isTokenExpired] No expiry date found - treating as expired");
  return false;   // ← logs "expired" but returns NOT-expired
}
```
**Why it matters:** if a TikTok row ever has a null `token_expires_at`, no refresh is attempted and a possibly-stale token is used for `creator_info` and publish, surfacing as a generic failure rather than a reconnect prompt. Shared across platforms (not TikTok-specific), but it sits on the compliance fetch path (`getTikTokCreatorInfoForAccount.ts:54`).
**Where a fix would live:** `ensureValidToken.ts:139` (return `true` to match the comment, or handle explicitly). Pre-existing shared-path quirk.
**Blast radius:** all platforms' token refresh.

### F11 (non-code) — Use-case positioning overlaps TikTok's "unacceptable use" examples
**Severity:** non-code finding (rejection risk)
**Requirement:** R14
**Where it shows in product:** the cross-platform fan-out (`handleSocialMediaPost.ts:95-309` posts one composition to LinkedIn/Pinterest/TikTok/Instagram at once) reads as "post-once-share-everywhere"; the share-link feature (`share_links` table `database.types.ts:1127-1173`; `initiated_via: "...share_link"` on `social_connections:1293`) lets one principal operate another person's TikTok connection. TikTok's Intended Use bars "a utility tool to help upload contents to the account(s) you or your team manages" and "an app that copies arbitrary contents from other platforms to TikTok." Both overlap.
**Why no code fix:** this is resolved in the audit-form use-case description and demo framing, not in code. See Open Questions.

### F12 (non-code) — Privacy policy never names TikTok
**Severity:** non-code finding (HIGH rejection risk)
**Requirement:** R15
**Where it is now:** `src/app/(marketing)/PrivacyPolicy/page.tsx` exists (linked at `footer.tsx:139` as `/PrivacyPolicy`; advertised in `tos/page.tsx:71` as `https://sharetopus.com/privacy-policy`). It addresses **YouTube API Services** (`:86-101`), **Google** (`:104-120`), and "Google OAuth access keys" encryption (`:166`), but contains **no mention of TikTok** and is dated "Last updated: 05/04/2025" (`:15`).
**Why it matters:** TikTok requires a privacy policy that addresses TikTok data handling. A policy that names only Google/YouTube is a rejection risk. Also note the route is `/PrivacyPolicy` (PascalCase) while the public URL advertised is `/privacy-policy` (kebab) — a possible 404/mismatch on whatever URL was submitted.
**Where a fix would live:** `PrivacyPolicy/page.tsx` content + confirm the canonical public URL. Not fabricated here — see Open Questions.

---

## 5. Reuse inventory (what a future fix should wire, not rebuild)

- **creator_info fetch (R1/R2, R8 duration source):** `getTikTokCreatorInfoForAccount(socialAccountId)` (`getTikTokCreatorInfoForAccount.ts:26`) is the per-account server action (resolves/refreshes token via `ensureValidToken`, then calls `getTikTokCreatorInfo`). It's the right target for any UI need because it works from a `social_account.id`; `getTikTokCreatorInfo(token)` (`getTikTokCreatorInfo.ts:35`) is the raw token-based call used at publish. The duration value is already in `useTikTokCreatorInfo` state — F3 should read it there, not refetch.
- **Privacy/interaction/brand body fields (R3/R4/R5):** built once in `handleVideoPost` (`postVideo.ts:63-79`) and `handleImagePost` (`postImage.ts:39-56`). Any field fix threads through the existing `tikTokOptions` argument — do not construct a parallel init call.
- **Persistence for scheduled posts (R3 persistence):** `schedulePostBatch.buildInsertRows` writes `post_options` (`schedulePostBatch.ts:498`); the worker rehydrates it in `callPlatformDirectPost` (`processSinglePostHelpers.ts:303,322-332`). F4's validation belongs in `schedulePostBatch.validatePostFields` (`:342`), extending the existing payload — not a new write path.
- **Preview (R7):** `FilePreview` via `SchedulingPanel.tsx:65-69` already renders media for all platforms; reuse it for any TikTok-specific preview enhancement.
- **Consent text (R6):** `SchedulingPanel.tsx:143-169` already renders both required strings; the Branded-Content variant toggles on `tikTokOptions.brandedContent` (`:54-56`).
- **Token/reauth (R1 edge):** `ensureValidToken` (`ensureValidToken.ts:13`) is the single refresh entry; the composer surfaces its error string in `TikTokSettingsTab.tsx:147,160-166`.

---

## 6. Edge-case behavior table

| Edge case | Observed behavior | Evidence |
|-----------|-------------------|----------|
| `privacy_level_options` empty / a field missing | Privacy dropdown renders empty (no options) and submit is blocked (no selection possible); interaction flags use `.some()` so a missing flag is falsy (treated as not-disabled). Controls hidden until ≥1 account loaded. | `TikTokSettingsTab.tsx:78-84,87-89,169` |
| Multi-account, differing capabilities | Privacy = **intersection** of all accounts' options; interaction = **most-restrictive** (disabled if *any* account disables). But a single shared `tikTokOptions` is sent to all accounts (options are global, not per-account). | `TikTokSettingsTab.tsx:78-89`; global state `SocialPostForm.tsx:194-199` |
| Settings change between query and publish | **Unhandled** — publish-time re-query result used only for username; TikTok rejects, surfaces as generic init error. | F5; `postToTikTok.ts:116-117`, `postVideo.ts:83-94` |
| Video longer than `max_video_post_duration_sec` | **Unhandled before upload** — no duration check; only TikTok rejects after pull. | F3; R8 row |
| Scheduled post's TikTok choices | **Persisted** to `scheduled_posts.post_options` and rehydrated by the worker — works for the web path; programmatic paths may persist none and default PUBLIC. | F4; `schedulePostBatch.ts:498`, `processSinglePostHelpers.ts:322-332` |
| 6-req/min creator_info limit | UI dedupes per account (`fetchedRef`), but publish re-queries per account; multi-account fan-out can approach the limit. | F6; `useTikTokCreatorInfo.ts:19,25-26`, `postToTikTok.ts:91` |
| Photo post: duet/stitch N/A | UI hides duet/stitch unless `postType==="video"`; body omits them for photos. | `TikTokSettingsTab.tsx:242`; `postImage.ts:44` |
| Token expired at compose time | `getTikTokCreatorInfoForAccount`→`ensureValidToken` refreshes; on failure shows "reconnect" error in the tab. Edge: null `token_expires_at` skips refresh (F10). | `getTikTokCreatorInfoForAccount.ts:54-67`; `TikTokSettingsTab.tsx:147`; F10 |

---

## 7. Open questions for Drew

1. **Demo/flag timing (highest priority).** When was the app/demo submitted to TikTok relative to 2026-05-09 (when `TIKTOK_COMPLIANCE_UI_ENABLED` was added and flipped on)? Does the submitted demo video show the current composer (privacy dropdown, toggles, consent line) or the pre-compliance screen? The flag comment says to re-record the demo on flip — was it re-recorded? `change/REPORT.md` (referenced at `defaults.ts:11`) is **not in the repo** — where does it live, and what does its "FIX TIKTOK-COMPLIANCE" entry say about demo status?
2. **R14 positioning.** Do you want to position Sharetopus as **creator self-publishing** (one creator posting their own content) or **agency/team management** (operating others' accounts via share-links)? The two demand different audit-form narratives and demo material. The share-link delegation and cross-platform fan-out currently read like the two patterns TikTok names as unacceptable; the resolution is in the use-case description, not code.
3. **R15 privacy policy.** Confirm the exact privacy-policy URL submitted to TikTok. The in-app route is `/PrivacyPolicy` (PascalCase) but the advertised URL is `sharetopus.com/privacy-policy` (kebab) — which is live? The current text names only YouTube/Google and is dated 05/04/2025; it needs a TikTok data-handling clause before resubmission.
4. **R13 `video.upload`.** Confirm in the TikTok developer dashboard whether `video.upload` is configured for the app. The code only Direct-Posts (needs `video.publish`); if `video.upload` isn't needed, drop it from both scope strings. If the dashboard's Direct-Post config force-includes it, document that for the reviewer.
5. **Partial-implementation uncertainty.** F4's claim that MCP/x402/REST schedulers can bypass privacy selection is inferred from `schedulePostBatch.validatePostFields` having no TikTok branch; I did not exhaustively read every MCP/REST caller's own pre-validation. Confirm whether any of those entry points validate TikTok privacy before calling `schedulePostBatch`.

---

## 8. Known-intentional patterns confirmed (deliberately NOT flagged)

Per the brief, these were observed and **not** reported as defects:
- **Async pull model** (TikTok pulls from a signed URL via `PULL_FROM_URL`) and the dual webhook + poll completion path converging on an idempotent finalize — `directPostForTikTokAccounts.ts:97-130` (insert `pending_tiktok_pulls` + dispatch poll), `processTikTokPublishWebhook.ts`, `tiktok_webhook_events` dedupe table.
- **Service-role admin Supabase client** bypassing RLS with default-deny + app-level ownership checks — `schedulePostBatch.checkOwnership` (`:388-413`), `getTikTokCreatorInfoForAccount.ts:29-34`.
- **HMAC-signed media proxy + signed-URL expiry** — `buildTikTokMediaUrl` path used at `processSinglePostHelpers.ts:179-192`.
- **`next.config.ts` `typescript.ignoreBuildErrors: true`** — intentional OOM mitigation; no cold `tsc`/build was run.
- **Dev/prod TikTok credential split** (`TIKTOK_CLIENT_KEY_DEV` / `TIKTOK_CLIENT_SECRET_DEV`) — `buildOAuthUrl.ts:74-77`, `refreshTikTokToken.ts:17-18`.
- **API-layer `SELF_ONLY`/`PUBLIC_TO_EVERYONE` default** is reported once, under R3/F4 (as "must be a user selection / fail-closed"), not as a separate complaint about the constant.

---

### File-map corrections (prompt paths vs reality)
- Composer handler is `src/actions/server/handleSocialMediaPost/handleSocialMediaPost.ts` (not `src/components/core/create/action/handleSocialMediaPost/`).
- `_shared` contains only `directPostForAccountsGeneric.ts` (+ `buildStreamingMultipartFormDataBody.ts`); there is **no** `scheduleForAccountGeneric.ts` / `processAccountsGeneric.ts`. Scheduling core is `src/actions/server/scheduleActions/schedule/schedulePostBatch.ts`; the scheduled worker logic is `src/inngest/functions/processSinglePostHelpers.ts`.
- `ensureValidToken.ts` is at `src/lib/api/ensureValidToken.ts` (not under `auth/`).
- `getTikTokProfile.ts` exists at the documented path (header comment says `client.ts`, stale).
- Both OAuth routes exist: `src/app/api/social/tiktok/connect/route.ts` and `.../initiate/route.ts`.
- A `TikTokSettingsTab.tsx` + `useTikTokCreatorInfo.ts` **do** exist — the prompt's "generic form, no TikTok panel" assumption is outdated.
