# RECON: TikTok Content Posting API Compliance Audit

Date: 2026-05-09
Branch: main
HEAD: b721ca4 chore(cleanup): spring cleaning sweep (FIX 18)

## 1. Why this recon exists

Sharetopus's TikTok Content Posting API application was **rejected** by TikTok review. The rejection states the demo video does not comply with the "Required UX Implementation in Your App" section of TikTok's Content Sharing Guidelines. The rejection is not about the video recording quality — the **app itself** does not implement the required UX elements. The form must be rebuilt to comply, then re-recorded, then resubmitted.

## 2. TikTok integration file map

### API Client
| File | Purpose |
|------|---------|
| `src/lib/api/tiktok/post/postToTikTok.ts` | Main entry: calls creator_info, routes to image/video handler |
| `src/lib/api/tiktok/post/postVideo.ts` | Video init via `/v2/post/publish/video/init/` (PULL_FROM_URL) |
| `src/lib/api/tiktok/post/postImage.ts` | Image init via `/v2/post/publish/content/init/` (PULL_FROM_URL) |
| `src/lib/api/tiktok/post/directPostForTikTokAccounts.ts` | Orchestrates single-account direct post flow |
| `src/lib/api/tiktok/data/getTikTokProfile.ts` | Fetches user profile via `/v2/user/info/` |
| `src/lib/api/tiktok/data/refreshTikTokToken.ts` | Token refresh |
| `src/lib/api/tiktok/data/exchangeTikTokCode.ts` | OAuth code exchange |
| `src/lib/api/tiktok/getTikTokPublishStatus.ts` | Polls `/v2/post/publish/status/fetch/` |
| `src/lib/api/tiktok/buildTikTokMediaUrl.ts` | Builds media URL for TikTok download |
| `src/lib/api/tiktok/buildProxiedTikTokMediaUrl.ts` | Proxy URL builder |
| `src/lib/api/tiktok/buildSupabaseDirectTikTokMediaUrl.ts` | Supabase direct URL builder |
| `src/lib/api/tiktok/processAccounts/processTiktokAccounts.ts` | Multi-account orchestrator |
| `src/lib/api/tiktok/schedule/scheduleForTikTokAccounts.ts` | Schedule path for TikTok |

### UI Components
| File | Purpose |
|------|---------|
| `src/components/core/create/SocialPostForm/SocialPostForm.tsx` | Main form component |
| `src/components/core/create/SocialPostForm/sections/AccountSelector.tsx` | Account toggle grid |
| `src/components/core/create/SocialPostForm/sections/CaptionsTab.tsx` | Per-account caption editing |
| `src/components/core/create/SocialPostForm/sections/PinterestSettingsTab.tsx` | Pinterest-specific settings |
| `src/components/core/create/SocialPostForm/sections/SchedulingPanel.tsx` | Schedule toggle, preview, submit button |
| `src/components/core/create/upload/VideoCoverSelector.tsx` | Video cover frame picker |
| `src/components/core/create/upload/VideoUpload.tsx` | Video file input |
| `src/components/core/create/upload/ImageUpload.tsx` | Image file input |
| `src/components/core/accounts/connectAccountsButton/ConnectTikTokButton.tsx` | OAuth connect button |

**NOTE: There is NO TikTokSettingsTab.tsx. Only PinterestSettingsTab exists as a platform-specific settings section.**

### State / Hooks / Validation
| File | Purpose |
|------|---------|
| `src/components/core/create/SocialPostForm/state/defaults.ts` | Default form state including TikTok options |
| `src/components/core/create/SocialPostForm/hooks/useAccountContent.ts` | Per-account content management |
| `src/components/core/create/SocialPostForm/validation/checkFormSubmission.ts` | Pre-submit validation (no TikTok checks) |

### Types
| File | Purpose |
|------|---------|
| `src/lib/types/dbTypes.ts:64-76` | `PrivacyLevel`, `TikTokOptions` types |
| `src/lib/types/TikTokProfile.ts` | TikTok user profile type |
| `src/lib/types/SchedulePostData.ts:14-27` | Scheduled post options including TikTok fields |

### Routes
| File | Purpose |
|------|---------|
| `src/app/api/social/tiktok/post/route.ts` | Direct post API route |
| `src/app/api/social/tiktok/process/route.ts` | Multi-account processing route |
| `src/app/api/social/tiktok/initiate/route.ts` | OAuth initiation |
| `src/app/api/social/tiktok/connect/route.ts` | OAuth callback |

### Inngest Workers
| File | Purpose |
|------|---------|
| `src/inngest/functions/tikTokPublishStatusPoll.ts` | Polls TikTok publish status until terminal |
| `src/inngest/functions/tikTokPublishStatusPollHelpers.ts` | Token resolution, history updates for poll |
| `src/inngest/functions/processSinglePost.ts` | Scheduled post executor |
| `src/inngest/functions/processSinglePostHelpers.ts:288-325` | Builds TikTok platformOptions from post_options |

### MCP Tools
| File | Purpose |
|------|---------|
| `src/lib/mcp/tools/schedulePost.ts` | MCP schedule_post tool |
| `src/lib/mcp/tools/bulkSchedule.ts` | MCP bulk_schedule tool |

### Action Layer
| File | Purpose |
|------|---------|
| `src/components/core/create/action/handleSocialMediaPost/handleSocialMediaPost.ts` | Central post orchestrator |
| `src/actions/server/scheduleActions/schedulePost.ts` | Server action schedule wrapper |
| `src/actions/server/data/pendingTikTokPulls.ts` | Pending TikTok pull CRUD |

## 3. Current form flow

When a user posts to TikTok today, this is the exact sequence:

### Step 1: Account selection
- User navigates to `/create/video` or `/create/image` (`src/app/(protected)/create/page.tsx`)
- `SocialPostForm` renders with `defaultPlatformOptions` which includes:
  ```
  tiktok: { privacyLevel: "SELF_ONLY", disableComment: false, disableDuet: false, disableStitch: false }
  ```
  (`src/components/core/create/SocialPostForm/state/defaults.ts:5-10`)
- User clicks TikTok account avatar in `AccountSelector` (`AccountSelector.tsx:99`)
- `handleAccountToggle` fires, adds account content entry (`SocialPostForm.tsx:121-148`)

### Step 2: Content creation
- User writes caption in Textarea (`SocialPostForm.tsx:441-461`)
- User uploads video/image via `VideoUploads`/`ImageUploads`
- For video: `VideoCoverSelector` appears for cover frame selection (`SocialPostForm.tsx:392-398`)
- **NO TikTok-specific settings are shown** — no privacy dropdown, no interaction checkboxes, no commercial disclosure

### Step 3: Submission
- User clicks "Publish Now" button (`SchedulingPanel.tsx:138-165`)
- `handleSubmit` → `checkFormSubmission` validation (`SocialPostForm.tsx:220-239`)
- `checkFormSubmission` has **zero TikTok-specific checks** (`checkFormSubmission.ts:38-175`)
- Media uploaded to Supabase Storage
- `handleSocialMediaPost` called with `platformOptions` containing hardcoded TikTok defaults (`SocialPostForm.tsx:286-305`)

### Step 4: Server-side processing
- `handleSocialMediaPost` (`handleSocialMediaPost.ts:62-588`) routes to `/api/social/tiktok/process`
- `processTiktokAccounts` (`processTiktokAccounts.ts:11-160`) processes each TikTok account
- `directPostForTikTokAccounts` (`directPostForTikTokAccounts.ts:16-215`) calls `postToTikTok`

### Step 5: TikTok API calls
- `postToTikTok` (`postToTikTok.ts:57-148`) calls `creator_info/query/` (line 89-98)
- creator_info response is received but **only used for `creator_username` in post URL** (line 103)
- `privacy_level_options`, `max_video_post_duration_sec`, `comment_disabled`, `duet_disabled`, `stitch_disabled` are **fetched but completely ignored**
- Routes to `handleVideoPost` or `handleImagePost`

### Step 6: Video init body (what actually reaches TikTok)
`postVideo.ts:63-76`:
```json
{
  "post_info": {
    "title": "<user caption>",
    "privacy_level": "SELF_ONLY",        // hardcoded default, never changed by user
    "disable_duet": false,               // hardcoded default
    "disable_comment": false,            // hardcoded default
    "disable_stitch": false,             // hardcoded default
    "video_cover_timestamp_ms": 1000     // from cover selector
  },
  "source_info": {
    "source": "PULL_FROM_URL",
    "video_url": "<signed url>"
  }
}
```
**Missing from init body**: `brand_content_toggle`, `brand_organic_toggle`, `is_aigc`

### Step 7: Image init body
`postImage.ts:39-54`:
```json
{
  "post_info": {
    "title": "<title>",
    "description": "<caption>",
    "privacy_level": "SELF_ONLY",        // hardcoded default
    "disable_comment": false,            // hardcoded default
    "auto_add_music": true               // hardcoded default
  },
  "source_info": {
    "source": "PULL_FROM_URL",
    "photo_images": ["<url>"],
    "photo_cover_index": 0
  },
  "post_mode": "DIRECT_POST",
  "media_type": "PHOTO"
}
```
**Missing from init body**: `brand_content_toggle`, `brand_organic_toggle`

### Step 8: Post-publish
- Status poll dispatched via Inngest (`directPostForTikTokAccounts.ts:169-179`)
- `tikTokPublishStatusPollWorker` polls until terminal (`tikTokPublishStatusPoll.ts:31-160`)
- **No processing notice shown to user in UI** — toast says "Successfully published" immediately

## 4. Compliance audit table

| # | Requirement | Sub-requirement | Status | Current (file:line) | Gap |
|---|---|---|---|---|---|
| 1 | Fetch creator_info on form render | Call creator_info/query/ when TikTok post page loads | **MISSING** | Called server-side during post submission only (`postToTikTok.ts:89-98`), NOT on form render | Need client-side fetch on form render when TikTok account selected |
| 1 | Display creator nickname | Show creator_nickname on upload page | **MISSING** | `creator_nickname` never displayed in UI. `creatorInfo.data.creator_username` used only for post URL (`postToTikTok.ts:103`) | Need to display in form when TikTok account selected |
| 1 | Block posting if creator can't post | Show "try again later" if creator_info indicates user cannot post | **MISSING** | No check for creator posting eligibility. Error only surfaces if TikTok API rejects the init | Need to check creator_info response for posting eligibility before showing form |
| 1 | Validate video duration | Check duration against `max_video_post_duration_sec` | **MISSING** | `max_video_post_duration_sec` is typed (`postToTikTok.ts:32`) and fetched but never compared to actual video duration. `VideoCoverSelector.tsx:36` reads duration but for cover selection only | Need to compare uploaded video duration against creator_info limit |
| 2 | Title input | Allow user to input title | **PARTIAL** | Caption/description field exists (`SocialPostForm.tsx:441-461`) but there's no separate title field for TikTok (title = description in `postVideo.ts:65`) | Title and description are conflated; title field may need to be surfaced |
| 2 | Privacy dropdown | Dropdown using `privacy_level_options` from creator_info, NO default | **MISSING** | No privacy dropdown in UI. Default hardcoded to `"SELF_ONLY"` (`defaults.ts:6`). Fallback `"PUBLIC_TO_EVERYONE"` in API (`postVideo.ts:66`, `postImage.ts:43`) | Need dropdown populated from creator_info, no pre-selected value |
| 2 | Allow Comment checkbox | User must manually toggle on, not checked by default | **MISSING** | No checkbox in UI. `disableComment: false` hardcoded (`defaults.ts:7`), meaning comments enabled by default without user action | Need checkbox, unchecked by default |
| 2 | Allow Duet checkbox | User must manually toggle on (video only) | **MISSING** | No checkbox in UI. `disableDuet: false` hardcoded (`defaults.ts:8`) | Need checkbox, unchecked by default, hidden for photo posts |
| 2 | Allow Stitch checkbox | User must manually toggle on (video only) | **MISSING** | No checkbox in UI. `disableStitch: false` hardcoded (`defaults.ts:9`) | Need checkbox, unchecked by default, hidden for photo posts |
| 2 | Grey out disabled interactions | If creator_info says disabled, grey out checkbox | **MISSING** | creator_info `comment_disabled`/`duet_disabled`/`stitch_disabled` fetched but never used to disable UI | Need to read creator_info and disable respective checkboxes |
| 2 | Photo: only Allow Comment | Photos should not show Duet/Stitch | **MISSING** | No checkboxes exist at all | Need conditional rendering: photo → only Comment checkbox |
| 2 | Music Usage Confirmation | Declaration text before publish button | **MISSING** | No declaration text anywhere. Grep `"Music Usage Confirmation"` returns 0 matches | Need text above publish button |
| 3 | Commercial content toggle | "Promotes yourself, a brand, product or service" OFF by default | **MISSING** | No commercial content UI. Grep `brand_content_toggle\|brand_organic_toggle\|Branded Content` returns 0 matches in ts/tsx | Need toggle switch in TikTok settings |
| 3 | Your Brand checkbox | When toggle ON, show "Your Brand" option | **MISSING** | — | Need checkbox under commercial toggle |
| 3 | Branded Content checkbox | When toggle ON, show "Branded Content" option | **MISSING** | — | Need checkbox under commercial toggle |
| 3 | At least one selected | Disable publish if toggle ON but neither selected | **MISSING** | — | Need validation in checkFormSubmission |
| 3 | Hover prompts | Show guidance text per selection state | **MISSING** | — | Need tooltip/text for each combination |
| 3 | Label text | "Promotional content" or "Paid partnership" based on selection | **MISSING** | — | Need dynamic label display |
| 4 | Branded Content cannot be SELF_ONLY | Disable SELF_ONLY when Branded Content checked | **MISSING** | — | Need privacy/commercial interaction logic |
| 5 | Declaration text: toggle OFF | "By posting, you agree to TikTok's Music Usage Confirmation" | **MISSING** | No declaration text | Need conditional text rendering |
| 5 | Declaration text: toggle ON, Your Brand only | Same text as toggle OFF | **MISSING** | — | Need conditional text rendering |
| 5 | Declaration text: toggle ON, Branded Content | "…agree to TikTok's Branded Content Policy and Music Usage Confirmation" | **MISSING** | — | Need conditional text rendering with different copy |
| 5 | Policy links | Link to actual TikTok policy URLs | **MISSING** | — | Need hyperlinks in declaration text |
| 6 | Content preview | Display preview of content | **IMPLEMENTED** | `FilePreview` rendered in `SchedulingPanel.tsx:58-63` via `previewUrl` from `SocialPostForm.tsx:78,108-118` | ✓ |
| 6 | No watermarks | No promotional watermarks/logos | **IMPLEMENTED** | Canvas usage in `VideoCoverSelector.tsx:59-79` is for cover frame extraction only, no watermark added | ✓ |
| 6 | Editable text | Preset text must be editable | **IMPLEMENTED** | Textarea in `SocialPostForm.tsx:441-461`, per-account editing in `CaptionsTab.tsx:98-116` | ✓ |
| 6 | Explicit consent | Send to TikTok only after publish click | **IMPLEMENTED** | `handleSubmit` triggered by button `onClick` (`SchedulingPanel.tsx:139`, `SocialPostForm.tsx:207`) | ✓ |
| 6 | Processing notice | Notify content may take minutes to appear | **MISSING** | Success toast says "Successfully published your content!" (`SocialPostForm.tsx:307-312`) — no processing notice | Need "Content may take a few minutes to appear on your TikTok profile" message |
| 6 | Status poll | Poll publish status or use webhooks | **IMPLEMENTED** | `tikTokPublishStatusPollWorker` in `tikTokPublishStatusPoll.ts:31-160`, triggered via `dispatchTikTokPublishPollEvent` (`directPostForTikTokAccounts.ts:169`) | ✓ |
| 7 | privacy_level in video init | User's selection, no default | **PARTIAL** | Sent (`postVideo.ts:66`) but with fallback `\|\| "PUBLIC_TO_EVERYONE"` and form default `"SELF_ONLY"` (`defaults.ts:6`) — user never chose | Remove fallback, require user selection |
| 7 | disable_comment in video init | Inverted from Allow Comment | **PARTIAL** | Sent (`postVideo.ts:68`) but always `false` (hardcoded default, no UI) | Wire to user checkbox |
| 7 | disable_duet in video init | Inverted from Allow Duet | **PARTIAL** | Sent (`postVideo.ts:67`) but always `false` | Wire to user checkbox |
| 7 | disable_stitch in video init | Inverted from Allow Stitch | **PARTIAL** | Sent (`postVideo.ts:69`) but always `false` | Wire to user checkbox |
| 7 | brand_content_toggle in video init | true if Branded Content checked | **MISSING** | Not in video init body (`postVideo.ts:63-71`) | Add to init body |
| 7 | brand_organic_toggle in video init | true if Your Brand checked | **MISSING** | Not in video init body | Add to init body |
| 7 | is_aigc in video init | AI-generated content disclosure | **MISSING** | Not in codebase. Grep `is_aigc` returns 0 matches | Add to init body (optional per TikTok docs) |
| 7 | privacy_level in photo init | User's selection, no default | **PARTIAL** | Sent (`postImage.ts:43`) with fallback `\|\| "PUBLIC_TO_EVERYONE"` | Remove fallback, require user selection |
| 7 | disable_comment in photo init | Inverted from Allow Comment | **PARTIAL** | Sent (`postImage.ts:44`) but always `false` | Wire to user checkbox |
| 7 | brand_content_toggle in photo init | true if Branded Content checked | **MISSING** | Not in photo init body (`postImage.ts:39-54`) | Add to init body |
| 7 | brand_organic_toggle in photo init | true if Your Brand checked | **MISSING** | Not in photo init body | Add to init body |
| 7 | auto_add_music in photo init | Optional | **IMPLEMENTED** | Sent as `true` (`postImage.ts:45`, `postToTikTok.ts:65`) | ✓ (defaults to true, acceptable) |

## 5. Required params currently missing in init bodies

### Video init body (`postVideo.ts:63-76`)

| Field | Required by TikTok | Present | Value | Issue |
|-------|-------------------|---------|-------|-------|
| `title` | Yes | ✓ | `description \|\| ""` | Sent as `title` key but value comes from `description` param |
| `privacy_level` | Yes (user-selected) | ✓ | `tikTokOptions?.privacyLevel \|\| "PUBLIC_TO_EVERYONE"` | Fallback default violates "no default" rule |
| `disable_duet` | Yes (user-toggled) | ✓ | `tikTokOptions?.disableDuet \|\| false` | Hardcoded default, no user input |
| `disable_comment` | Yes (user-toggled) | ✓ | `tikTokOptions?.disableComment \|\| false` | Hardcoded default, no user input |
| `disable_stitch` | Yes (user-toggled) | ✓ | `tikTokOptions?.disableStitch \|\| false` | Hardcoded default, no user input |
| `video_cover_timestamp_ms` | Optional | ✓ | `resolvedCoverTs` (clamped ≥1000ms) | ✓ |
| `brand_content_toggle` | Yes (if commercial) | ✗ | — | MISSING |
| `brand_organic_toggle` | Yes (if commercial) | ✗ | — | MISSING |
| `is_aigc` | Optional | ✗ | — | MISSING (optional but recommended) |

### Photo init body (`postImage.ts:39-54`)

| Field | Required by TikTok | Present | Value | Issue |
|-------|-------------------|---------|-------|-------|
| `title` | Yes | ✓ | `title \|\| ""` | ✓ |
| `description` | Yes | ✓ | `description \|\| ""` | ✓ |
| `privacy_level` | Yes (user-selected) | ✓ | `tikTokOptions?.privacyLevel \|\| "PUBLIC_TO_EVERYONE"` | Fallback default violates "no default" rule |
| `disable_comment` | Yes (user-toggled) | ✓ | `tikTokOptions?.disableComment \|\| false` | Hardcoded default, no user input |
| `auto_add_music` | Optional | ✓ | `autoAddMusic` (default `true`) | ✓ |
| `brand_content_toggle` | Yes (if commercial) | ✗ | — | MISSING |
| `brand_organic_toggle` | Yes (if commercial) | ✗ | — | MISSING |

## 6. Photo posting status

Photo posting **IS implemented** for TikTok via `postImage.ts` using the `/v2/post/publish/content/init/` endpoint. It sends a single image via `photo_images` array with `PULL_FROM_URL` source and `DIRECT_POST` mode.

Compliance impact: Photo posts need the same compliance treatment as video posts (privacy dropdown, Allow Comment checkbox, commercial disclosure) except Duet and Stitch checkboxes should be hidden for photos per TikTok requirements.

## 7. Architecture proposal (no code)

### New files

| File | Purpose |
|------|---------|
| `src/lib/api/tiktok/data/getTikTokCreatorInfo.ts` | Server action: calls `creator_info/query/`, returns typed `CreatorInfoResponse`. Reuses the existing `CreatorInfoResponse` type from `postToTikTok.ts:23-39` (move type to shared location) |
| `src/components/core/create/SocialPostForm/sections/TikTokSettingsTab.tsx` | New tab component: privacy dropdown, interaction checkboxes, commercial disclosure toggle+checkboxes, declaration text. Conditional rendering based on `postType` (photo vs video) |
| `src/components/core/create/SocialPostForm/hooks/useTikTokCreatorInfo.ts` | Client hook: fetches creator_info via server action when TikTok account selected, caches within form session, exposes `creatorInfo`, `isLoading`, `canPost` |

### Edits to existing files

| File | Changes needed |
|------|---------------|
| `src/lib/types/dbTypes.ts:64-76` | Add `FOLLOWER_OF_CREATOR` to `PrivacyLevel` union. Add `brandContentToggle`, `brandOrganicToggle`, `isAigc` to `TikTokOptions` interface |
| `src/components/core/create/SocialPostForm/state/defaults.ts:5-10` | Change TikTok defaults: remove `privacyLevel` default (make it `undefined`/`null` to enforce no pre-selection), add `brandContentToggle: false`, `brandOrganicToggle: false` |
| `src/components/core/create/SocialPostForm/SocialPostForm.tsx` | Mount `TikTokSettingsTab` in the Tabs section when TikTok accounts are selected. Initialize `useTikTokCreatorInfo` hook. Pass creator_info data and platformOptions setters down |
| `src/components/core/create/SocialPostForm/validation/checkFormSubmission.ts` | Add TikTok-specific validation: privacy must be selected (not null), commercial toggle ON requires at least one checkbox, branded content cannot be SELF_ONLY |
| `src/lib/api/tiktok/post/postVideo.ts:63-76` | Add `brand_content_toggle`, `brand_organic_toggle`, `is_aigc` to init body. Remove `\|\| "PUBLIC_TO_EVERYONE"` fallback (require explicit value). Remove `\|\| false` fallbacks for disable fields |
| `src/lib/api/tiktok/post/postImage.ts:39-54` | Add `brand_content_toggle`, `brand_organic_toggle` to init body. Remove privacy fallback |
| `src/lib/api/tiktok/post/postToTikTok.ts:23-39` | Move `CreatorInfoResponse` type to shared types file (or keep and re-export). Remove the creator_info call from here — it should happen earlier in the flow (form render), not at post time. OR keep server-side call but also add a separate form-render call |
| `src/components/core/create/SocialPostForm/sections/SchedulingPanel.tsx` | Add declaration text above publish button (text varies by commercial toggle state). Add processing notice text |
| `src/lib/types/SchedulePostData.ts:14-27` | Add `brandContentToggle`, `brandOrganicToggle`, `isAigc` to `postOptions` type |
| `src/inngest/functions/processSinglePostHelpers.ts:270-325` | Add `brandContentToggle`, `brandOrganicToggle`, `isAigc` to `PostOptions` type and `callPlatformDirectPost` platformOptions construction |
| `src/lib/mcp/tools/schedulePost.ts:47,79` | Add TikTok options to schema (privacy_level, disable_comment, disable_duet, disable_stitch, brand_content_toggle, brand_organic_toggle). Pass to `postOptions` instead of `null` |
| `src/lib/mcp/tools/bulkSchedule.ts:16-24,307` | Add TikTok options to `postSchema`. Pass to `post_options` in row builder |
| `src/components/core/create/action/handleSocialMediaPost/successMessage.ts` | Add processing notice text for TikTok posts |

### Schema considerations

- `scheduled_posts.post_options` is `jsonb` — flexible enough to hold the new fields (`brandContentToggle`, `brandOrganicToggle`, `isAigc`) without a migration
- `TikTokOptions` interface in `dbTypes.ts` is the canonical shape; `post_options` stores a serialized copy
- No DB migration needed. The `PlatformOptions` / `TikTokOptions` types just need to be extended
- `PrivacyLevel` union type needs `FOLLOWER_OF_CREATOR` added — this is a TikTok-specific value that can appear in `privacy_level_options`

### MCP tool ripple

| Tool | File | Current issue | Change needed |
|------|------|---------------|---------------|
| `schedule_post` | `src/lib/mcp/tools/schedulePost.ts:79` | Passes `postOptions: null` — no TikTok options | Add optional TikTok option fields to schema, pass through to `postOptions` |
| `bulk_schedule` | `src/lib/mcp/tools/bulkSchedule.ts:307` | Passes `post_options: null` in row builder | Add TikTok option fields to `postSchema`, populate `post_options` in `buildScheduledPostRows` |
| `listScheduledPosts` | `src/lib/mcp/tools/listScheduledPosts.ts` | Read-only, surfaces `post_options` as-is | No change needed |
| `listContentHistory` | `src/lib/mcp/tools/listContentHistory.ts` | Read-only | No change needed |

For MCP tools: TikTok compliance means the agent MUST provide `privacy_level` (no default). The MCP schema should make `privacy_level` required when `platform === "tiktok"`. Interaction flags can default to `false` (meaning disabled/unchecked). Commercial flags default to `false`.

### Photo posting decision

Photo posting is already implemented and should be brought into compliance alongside video. The compliance work is the same (privacy dropdown, Allow Comment checkbox, commercial disclosure) with the only difference being that Duet and Stitch checkboxes are hidden for photos. This is a conditional rendering concern, not a separate feature.

**Recommendation: Include photo compliance in the same FIX. Do not defer.**

## 8. Risk and tradeoff notes

### UX friction (intentional per TikTok)

1. **No default privacy** means the user MUST click the privacy dropdown every time. This is required by TikTok's guidelines. The previous approach of defaulting to `SELF_ONLY` was non-compliant.

2. **Interaction checkboxes unchecked by default** means users must opt in to allow comments, duets, and stitches. This is required behavior — TikTok wants explicit consent for each interaction type.

3. **Commercial disclosure** adds UI complexity for users who will never use it (most users). But it cannot be omitted — TikTok's review explicitly checks for it.

### State shape change ripple

Changing `TikTokOptions` to require `privacyLevel` as non-optional-but-nullable (user must explicitly select) ripples to:
- `defaults.ts` — privacy must be `undefined`/`null` instead of `"SELF_ONLY"`
- `checkFormSubmission.ts` — must reject if privacy is null/undefined when TikTok accounts are selected
- `processSinglePostHelpers.ts:319` — fallback `?? "PUBLIC_TO_EVERYONE"` must be removed or throw
- All MCP tools scheduling TikTok posts must provide privacy

### creator_info API call timing

The spec requires fetching creator_info "on render of the TikTok post page". This means a server action call from the client when a TikTok account is selected. This adds a network request to the form interaction. Within a form session, the result can be cached (won't change mid-session). But each new form load or account switch should re-fetch.

### `FOLLOWER_OF_CREATOR` privacy level

The current `PrivacyLevel` type (`dbTypes.ts:64-69`) is missing `FOLLOWER_OF_CREATOR`. This is a TikTok-specific privacy level that can appear in `privacy_level_options`. If a creator's account returns this option and the type doesn't include it, TypeScript will reject it. Must be added to the union.

### Default `autoAddMusic` for photos

Currently hardcoded to `true` (`postToTikTok.ts:65`). TikTok docs say this is optional. Ideally, the user should be able to toggle this. However, this is NOT in the rejection criteria, so it can be deferred.

## 9. Demo video re-recording checklist

Once the FIX ships, the new demo video must show these elements in order:

- [ ] Navigate to the create/post page
- [ ] Select a TikTok account — show that creator_info loads (creator nickname displayed)
- [ ] Upload a video or image
- [ ] Show the **Privacy Level dropdown** — demonstrate it has NO default, user must select
- [ ] Select a privacy level from the dropdown (showing options from creator_info)
- [ ] Show the **Allow Comment checkbox** — demonstrate it is unchecked by default
- [ ] Show the **Allow Duet checkbox** (video only) — demonstrate unchecked by default
- [ ] Show the **Allow Stitch checkbox** (video only) — demonstrate unchecked by default
- [ ] Toggle some interaction checkboxes ON to show they work
- [ ] Show the **Commercial Content Disclosure toggle** — demonstrate OFF by default
- [ ] Turn the toggle ON — show Your Brand and Branded Content checkboxes appear
- [ ] Select "Your Brand" — show "Promotional content" label
- [ ] Select "Branded Content" — show "Paid partnership" label
- [ ] Show that SELF_ONLY is disabled in privacy dropdown when Branded Content is checked
- [ ] Show the **declaration text** changes based on commercial selections
- [ ] Show the **Music Usage Confirmation** text
- [ ] Write/edit a caption (show text is editable)
- [ ] Click **Publish Now** — show explicit consent via button click
- [ ] Show **processing notice** ("Content may take a few minutes to appear")
- [ ] (Optional) Show a photo post flow with only Allow Comment checkbox (no Duet/Stitch)

## 10. Out of scope for FIX TIKTOK-COMPLIANCE

Per the existing roadmap, the following are NOT part of this compliance work:

- **FIX 19**: Security audit (XSS, CSRF, etc.)
- **FIX 20**: Error handling / throw hygiene
- **FIX 21**: TypeScript strict type improvements
- **FIX 22-26**: Platform deduplication / multi-platform refactoring
- **autoAddMusic UI toggle**: Optional per TikTok, not in rejection criteria
- **is_aigc UI toggle**: Optional per TikTok, but should be included in init body structure even if UI is deferred
- **Multi-image photo posts**: Current code sends single image in `photo_images` array. Multi-image is a feature expansion, not a compliance requirement
- **Video duration enforcement in upload component**: While creator_info provides `max_video_post_duration_sec`, enforcement could happen at upload time or at submit time. The recon recommends submit-time validation as the minimum viable compliance step

## 11. What was NOT investigated

1. **TikTok's exact API error response** when `brand_content_toggle`/`brand_organic_toggle` are omitted — confirmed missing from code, but unknown if TikTok rejects or silently defaults
2. **Whether `FOLLOWER_OF_CREATOR` is actually returned** for any current test accounts — the type should include it regardless, but real-world validation requires a live API call
3. **OAuth scopes** — whether the current OAuth flow requests the scopes needed for creator_info (likely `user.info.profile` and `video.publish`). The connect route (`src/app/api/social/tiktok/connect/route.ts`) was not read for scope configuration
4. **Webhook-based status** vs polling — the current implementation uses polling (FIX 17.1). TikTok also supports webhooks. Compliance only requires one method; polling is sufficient
5. **Rate limiting on creator_info calls** — if many TikTok accounts are selected, multiple creator_info calls fire. TikTok's rate limits for this endpoint were not investigated
6. **Exact TikTok policy URLs** for Music Usage Confirmation and Branded Content Policy links — need to be sourced from TikTok's official documentation
7. **Instagram/Pinterest compliance** — this recon is TikTok-specific. Other platforms may have similar UX requirements that are not audited here
8. **Mobile responsiveness** of the new TikTok settings tab — the current form uses responsive classes but the new tab's layout needs design consideration
