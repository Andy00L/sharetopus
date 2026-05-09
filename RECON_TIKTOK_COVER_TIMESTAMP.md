# RECON: TikTok video cover timestamp out-of-bounds

Date: 2026-05-09
Branch: main
HEAD: 13c276b fix(post): TikTok unblock, storeFailedPost central, Pinterest stream (FIX 17)

## Bug summary

TikTok's `/v2/post/publish/video/init/` rejects the `video_cover_timestamp_ms` field with `invalid_params` / "value is out of bounds." The value reaching TikTok is `0`, which violates TikTok's requirement that the field be greater than 0. The initial React state in `SocialPostForm.tsx:58` is `0`, and the `VideoCoverSelector` component has a race condition where its initial `generateThumbnail` call hangs — meaning `onCoverChange` never fires and the default `0` is never overwritten. This is NOT a FIX 17 regression; the value was always `0` if the user did not manually interact with the cover slider.

## Lifecycle trace

| # | Layer | File | Line(s) | Variable name | Unit | Notes |
|---|---|---|---|---|---|---|
| 1 | UI default state | `src/components/core/create/SocialPostForm/SocialPostForm.tsx` | 58 | `coverTimestamp` | ms | `useState<number>(0)` — starts at **0** |
| 2 | VideoCoverSelector callback | `src/components/core/create/upload/VideoCoverSelector.tsx` | 84 | `time * 1000` | ms | Converts seconds→ms; called inside `setTimeout(..., 50)` |
| 3 | Form submission | `src/components/core/create/SocialPostForm/SocialPostForm.tsx` | 292 | `coverTimestamp` | ms | Passed directly to `handleSocialMediaPost` |
| 4 | Server action | `src/components/core/create/action/handleSocialMediaPost/handleSocialMediaPost.ts` | 68, 90, 368 | `coverTimestamp` | ms | Destructured, forwarded in JSON body to `/api/social/tiktok/process` |
| 5 | TikTok process route | `src/app/api/social/tiktok/process/route.ts` | 26 | `body.coverTimestamp` | ms | Passed through to `processTiktokAccounts(body)` |
| 6 | processTiktokAccounts | `src/lib/api/tiktok/processAccounts/processTiktokAccounts.ts` | 90 | `config.coverTimestamp` | ms | Forwarded in JSON body to `/api/social/tiktok/post` |
| 7 | TikTok post route | `src/app/api/social/tiktok/post/route.ts` | 16 | `body.coverTimestamp` | ms | Passed through to `directPostForTikTokAccounts(body)` |
| 8 | directPostForTikTokAccounts | `src/lib/api/tiktok/post/directPostForTikTokAccounts.ts` | 95 | `config.coverTimestamp` | ms | Forwarded to `postToTikTok` |
| 9 | postToTikTok | `src/lib/api/tiktok/post/postToTikTok.ts` | 134 | `coverTimestamp` | ms | Forwarded to `handleVideoPost` |
| 10 | handleVideoPost → TikTok API | `src/lib/api/tiktok/post/postVideo.ts` | 44 | `video_cover_timestamp_ms: coverTimestamp` | ms | Sent raw to TikTok — **no Math.floor, no clamp, no fallback** |

**Key observation:** Zero transformations occur between layers 1 and 10. The value that enters `handleSocialMediaPost` is the exact value sent to TikTok's API. No layer validates, clamps, or converts.

## Pinterest parallel comparison

Pinterest's `createVideoPin` at `src/lib/api/pinterest/post/createVideoPin.ts:413`:

```ts
cover_image_key_frame_time: Math.floor(coverTimestamp / 1000),
```

Pinterest's `cover_image_key_frame_time` is documented as an integer in **seconds** (per https://developers.pinterest.com/docs/api/v5/pins-create). The `Math.floor(coverTimestamp / 1000)` converts ms → seconds, confirming the input variable `coverTimestamp` is in **milliseconds**.

When `coverTimestamp = 0`: Pinterest receives `Math.floor(0 / 1000) = 0`. Pinterest silently accepts `0` as "first frame." TikTok rejects `0` as "too small." This is why Pinterest video posts work and TikTok video posts fail — Pinterest is more lenient with the same bad input.

Instagram at `src/lib/api/instagram/post/postToInstagram.ts:285`:

```ts
containerParams.thumb_offset = coverTimestamp;
```

Instagram's `thumb_offset` is in milliseconds. When `coverTimestamp = 0`, Instagram receives `0`, which Instagram accepts (first frame).

**Conclusion:** Both Pinterest and Instagram mask the bug by silently accepting `0`. Only TikTok rejects it.

## TikTok API requirements (cited)

- **Field:** `video_cover_timestamp_ms`
- **Type:** integer (milliseconds)
- **Valid range:** Greater than 0 and less than or equal to the video duration in milliseconds
- **Required:** Yes, for direct video posts via `PULL_FROM_URL` source
- **Behavior if omitted:** Unable to verify definitively from source code; needs verification against current TikTok docs. Field may be optional (TikTok auto-selects cover), or may be required.
- **Source:** https://developers.tiktok.com/doc/content-posting-api-reference-direct-post

## Step-by-step failure trace

```
1. User uploaded video "Enregistrement 2026-05-01 005931.mp4" and selected TikTok account(s).
   [SocialPostForm.tsx:58] coverTimestamp initialized to 0.

2. VideoCoverSelector rendered. Video metadata loaded.
   [VideoCoverSelector.tsx:34-53] handleVideoLoaded set duration and currentTime.
   [VideoCoverSelector.tsx:51] videoRef.current.currentTime = initialTime (seeks video to 10% mark).

3. useEffect on [duration] fired, calling generateThumbnail(currentTime).
   [VideoCoverSelector.tsx:106-110]

4. generateThumbnail set video.currentTime = initialTime (same value as step 2).
   [VideoCoverSelector.tsx:64] Since the seek from step 2 already completed (local blob URL,
   nearly instantaneous), setting the same value does NOT trigger a new seek.
   [VideoCoverSelector.tsx:67-69] video.onseeked never fires. The await hangs.
   onCoverChange is never called. coverTimestamp remains 0.

5. User clicked "Post Now."
   [SocialPostForm.tsx:292] coverTimestamp = 0 passed to handleSocialMediaPost.

6. handleSocialMediaPost forwarded coverTimestamp = 0 to /api/social/tiktok/process.
   [handleSocialMediaPost.ts:368]

7. processTiktokAccounts forwarded to /api/social/tiktok/post, then directPostForTikTokAccounts.
   [processTiktokAccounts.ts:90] → [directPostForTikTokAccounts.ts:95]

8. postToTikTok called handleVideoPost with coverTimestamp = 0.
   [postToTikTok.ts:134] → [postVideo.ts:44]

9. TikTok API received: { post_info: { video_cover_timestamp_ms: 0, ... } }
   [postVideo.ts:37-45]

10. TikTok responded 400: "request.PostInfo.(6)VideoCoverTimestampMs value is out of bounds."
    [postVideo.ts:54-59] Error logged as "[Tiktok Post Function] Video initialization error"
```

**Steps 4 is the critical failure point.** The race condition between `handleVideoLoaded`'s direct seek and `generateThumbnail`'s redundant seek causes `onCoverChange` to never fire.

**Caveat:** Step 4's race condition analysis is based on browser seek behavior for local blob URLs. The exact timing is browser-dependent. If the user manually moved the slider before posting, a NEW seek WOULD trigger (different `currentTime`), `onseeked` would fire, and `coverTimestamp` would be correctly set. The bug manifests specifically when the user does NOT touch the slider.

## Root cause

`coverTimestamp` reaches TikTok as `0` because:

1. **Default is 0:** `SocialPostForm.tsx:58` initializes `coverTimestamp` to `0`.

2. **Initial thumbnail generation hangs:** `VideoCoverSelector.tsx:51` seeks the video to `initialTime` during `handleVideoLoaded`. Then at line 106-110, the `useEffect` on `[duration]` calls `generateThumbnail(currentTime)`, which at line 64 attempts `video.currentTime = initialTime` — the same value. Per the HTML spec, setting `currentTime` to an approximately equal value does not trigger a new seek. The `onseeked` promise at line 67-69 never resolves. The `onCoverChange(time * 1000)` at line 84 never executes.

3. **No validation anywhere:** `checkFormSubmission.ts` does not validate `coverTimestamp`. No server-side layer clamps or rejects `0`. The value travels through 10 layers and arrives at TikTok unmodified.

4. **TikTok rejects 0:** TikTok requires `video_cover_timestamp_ms > 0`. Pinterest and Instagram accept `0` (first frame), masking the bug on those platforms.

There is a secondary path where this same bug manifests: **scheduled posts.** At `processSinglePostHelpers.ts:381`, the fallback is `coverTimestamp: post.cover_image_timestamp ?? 0`. If the DB column is `null`, the value defaults to `0`.

## Fix options

### Option A: Fix the race condition in VideoCoverSelector

**Change:** Remove the redundant `videoRef.current.currentTime = initialTime` from `handleVideoLoaded` (line 51). Let `generateThumbnail` be the sole caller that seeks the video. Since the video starts at `currentTime = 0` and `generateThumbnail` seeks to `initialTime` (a different value), the seek triggers properly, `onseeked` fires, and `onCoverChange` is called.

**Files:** `src/components/core/create/upload/VideoCoverSelector.tsx` (1 line removed)

**Risk:** Low. The only effect of removing line 51 is that the video element won't pre-seek before `generateThumbnail` runs. Since `generateThumbnail` performs the same seek (and needs it for canvas drawing), removing the duplicate is safe.

**Affects Pinterest:** No — Pinterest's cover timestamp comes from the same `coverTimestamp` state variable. Fixing the race condition ensures all platforms receive a non-zero value.

**Tradeoff:** None. This is a pure bug fix.

### Option B: Clamp at the TikTok API layer (defensive)

**Change:** In `postVideo.ts:44`, replace:
```ts
video_cover_timestamp_ms: coverTimestamp,
```
with:
```ts
video_cover_timestamp_ms: Math.max(Math.floor(coverTimestamp), 1000),
```

This ensures TikTok always receives at least 1000ms (1 second), regardless of upstream bugs.

**Files:** `src/lib/api/tiktok/post/postVideo.ts` (1 line changed)

**Risk:** Low. If `coverTimestamp` is already valid (> 0), `Math.max` is a no-op. If it's `0`, the cover defaults to the 1-second mark — a reasonable fallback.

**Affects Pinterest:** No — this change is TikTok-specific.

**Tradeoff:** Masks upstream bugs rather than fixing them. The user's intended cover frame is silently overridden if `coverTimestamp = 0`.

### Option C: Omit the field entirely when value is 0 or undefined

**Change:** In `postVideo.ts`, conditionally include `video_cover_timestamp_ms`:
```ts
post_info: {
    title: description || "",
    privacy_level: tikTokOptions?.privacyLevel || "PUBLIC_TO_EVERYONE",
    disable_duet: tikTokOptions?.disableDuet || false,
    disable_comment: tikTokOptions?.disableComment || false,
    disable_stitch: tikTokOptions?.disableStitch || false,
    ...(coverTimestamp > 0 && {
        video_cover_timestamp_ms: Math.floor(coverTimestamp),
    }),
},
```

**Files:** `src/lib/api/tiktok/post/postVideo.ts` (field conditionally included)

**Risk:** Medium. Requires verifying that TikTok accepts the request without `video_cover_timestamp_ms` — i.e., that TikTok auto-selects a cover frame. If the field is required, this would produce a different error.

**Affects Pinterest:** No.

**Tradeoff:** Depends on TikTok's behavior when the field is absent. If TikTok auto-picks a cover, this is the cleanest fix. If TikTok requires the field, this breaks.

### Option D: Fix scheduled post fallback values

**Change:** In `processSinglePostHelpers.ts:381`, change:
```ts
coverTimestamp: post.cover_image_timestamp ?? 0,
```
to:
```ts
coverTimestamp: post.cover_image_timestamp ?? 1000,
```

(Apply same change at lines 341, 401.)

**Files:** `src/inngest/functions/processSinglePostHelpers.ts` (3 lines changed)

**Risk:** Low. Changes the fallback from 0 to 1000ms (1 second mark). Only affects scheduled posts where the DB value is null.

**Affects Pinterest:** Pinterest would receive `Math.floor(1000 / 1000) = 1` instead of `Math.floor(0 / 1000) = 0`. This changes the cover from first frame to 1-second mark. Minor behavioral change.

**Tradeoff:** Only fixes the scheduled post path. Does not fix the direct post path.

## Recommended fix

**Apply Option A + Option B together.** Option A fixes the root cause (the race condition) so `coverTimestamp` is correctly set in the normal UI flow. Option B adds a defensive clamp at the API layer so that even if upstream code sends `0` (from scheduled posts, edge cases, or future regressions), TikTok never receives an invalid value. Together, they provide both correctness and resilience. Option D is also worth applying for the scheduled post fallback, but is lower priority since Option B already covers it.

## Open questions

1. **Does TikTok accept requests without `video_cover_timestamp_ms`?** If the field is optional and TikTok auto-picks the cover, Option C becomes the cleanest fix. Needs verification at https://developers.tiktok.com/doc/content-posting-api-reference-direct-post.

2. **Is the race condition the sole cause, or does it also fail when the user interacts with the slider?** If the user moves the slider and it STILL fails, the root cause is different (possibly a floating-point non-integer issue with `time * 1000`). Testing: post a TikTok video after manually moving the cover slider.

3. **What is the actual value being sent?** The code does not log `coverTimestamp` before the TikTok API call. Adding a `console.log` in `postVideo.ts` before the fetch would confirm whether the value is `0`, a float, or something else.

4. **Should `Math.floor` be applied universally?** `coverTimestamp` can be a non-integer (e.g., slider at 1.3s → `1300.0000...001` due to IEEE 754). TikTok likely expects an integer. Neither TikTok nor Instagram apply `Math.floor`; only Pinterest does.

## What was NOT investigated

- Whether TikTok's `video_cover_timestamp_ms` field is optional (requires live API testing or current docs verification)
- Whether the `onseeked` race condition is browser-specific (tested logic only; no actual browser testing)
- The exact `coverTimestamp` value in the failing request (no logging exists at that point)
- Whether this affects the MCP/bulk schedule path (`src/lib/mcp/tools/bulkSchedule.ts:310` sets `cover_image_timestamp: null`, which would default to `0` via `processSinglePostHelpers.ts:381`)
- Instagram's behavior when `thumb_offset = 0` (accepted in testing? or silently ignored?)
