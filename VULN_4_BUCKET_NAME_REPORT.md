# Vuln 4 Report -- User-Controlled Supabase Bucket Name

**Branch:** main
**Build state:** clean (tsc --noEmit + npm run build)
**Generated:** 2026-05-15

## Summary

Removed user-controlled `bucketName` from the web upload route, the shared
server helper, and the client-side upload function. `process.env.SUPABASE_BUCKET_NAME`
is now the only source of bucket configuration. The MCP and REST media paths
were already safe and required no changes. Also renamed a local `bucketName`
variable in the usage route to `storageBucket` to fully eliminate the identifier
from the codebase.

## Files Modified

| File | Change |
|---|---|
| src/actions/server/data/generateServerSignedUploadUrl.ts | Removed `bucketName` from `GenerateUploadUrlInput` interface; changed bucket resolution from `input.bucketName ?? process.env.SUPABASE_BUCKET_NAME` to `process.env.SUPABASE_BUCKET_NAME` |
| src/app/api/storage/generate-upload-url/route.ts | Removed `bucketName` from body destructure and helper call args |
| src/actions/client/signedUrlUpload.ts | Removed `bucketName` param from `getSignedUploadUrl` signature and from fetch body |
| src/app/api/v1/usage/route.ts | Renamed unrelated local variable `bucketName` to `storageBucket` (zero-hit requirement) |

## Callsite Audit

| Callsite | Before fix | After fix |
|---|---|---|
| Web route (`generate-upload-url/route.ts`) | Passed user-supplied `bucketName` | Does not read or pass it; env wins |
| Client (`signedUrlUpload.ts`) | Sent `bucketName` in fetch body | No longer sends it |
| MCP `request_upload_url` tool | Never passed `bucketName` | Unchanged |
| REST `/v1/media/upload-url` | Never passed `bucketName` | Unchanged |
| Usage route (`/v1/usage/route.ts`) | Unrelated local var named `bucketName` | Renamed to `storageBucket` |

## Invariant Verification

| # | Check | Result |
|---|---|---|
| I1 | `bucketName` returns 0 hits in `src/` | OK |
| I2 | Helper reads only from `process.env.SUPABASE_BUCKET_NAME` | OK |
| I3 | Web route does not reference `bucketName` | OK |
| I4 | `GenerateUploadUrlInput` interface has no `bucketName` | OK |
| I5 | No `any` introduced | OK |
| I6 | No em-dash in modified files | OK |
| I7 | Client file has no `bucketName` | OK |

## Edge Case Audit

| # | Input | Expected behavior |
|---|---|---|
| 1 | Normal request (no `bucketName` in body) | Uses `SUPABASE_BUCKET_NAME` env, signed URL minted |
| 2 | `{ ..., bucketName: "evil" }` in body | `bucketName` ignored (not destructured), env bucket used |
| 3 | `{ ..., bucketName: "" }` in body | Same: env bucket used |
| 4 | `{ ..., bucketName: null }` in body | Same: env bucket used |
| 5 | `SUPABASE_BUCKET_NAME` unset in env | Returns `{ success: false, reason: "missing_bucket_env" }` with 500 (existing behavior) |
| 6 | Other valid request (no tampering) | No change in behavior |
| 7 | MCP `request_upload_url` call | No change (never passed `bucketName`) |
| 8 | REST `POST /v1/media/upload-url` | No change (never passed `bucketName`) |

## Smoke Test Results

Pending Drew deploy.

## Risks / Open Items

- Confirm `SUPABASE_BUCKET_NAME` is set in production Vercel env. If missing, all uploads return `missing_bucket_env`.
- No other regression vectors identified.

## Metrics

- Files modified: 4
- Lines removed: ~7
- Interface fields removed: 1 (`bucketName`)
- Function params removed: 1 (`bucketName` in client `getSignedUploadUrl`)
- Callsites updated: 2 (server route + client fetch)
- Local variables renamed: 1 (`bucketName` to `storageBucket` in usage route)
