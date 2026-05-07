# Supabase Integration

Sharetopus uses Supabase (`@supabase/supabase-js ^2.105.3`) for its database and file storage.

## Overview

| Field | Value |
|-------|-------|
| Package | `@supabase/supabase-js ^2.105.3` |
| Total tables | 27 (from migration) |
| Row Level Security | Enabled on all tables |
| Storage bucket | `scheduled-videos` (used for all media types, not just videos) |
| Storage path format | `{userId}/{uuid}.{ext}` |

## Two-Client Pattern

Sharetopus creates two separate Supabase clients for different access levels:

| Client | File | Auth | RLS |
|--------|------|------|-----|
| User-scoped | `src/lib/supabase.ts` | Clerk JWT | Enforced |
| Admin | `src/lib/adminSupabase.ts` | Service role key | Bypassed |

**User-scoped client** - used for operations where the current user's identity matters. Passes the Clerk JWT so that Supabase RLS policies can restrict access to the user's own data.

**Admin client** - used for server-side operations that need unrestricted access, such as webhook handlers, cron jobs, and cross-user queries. The service role key bypasses all RLS policies.

## Row Level Security

All 27 tables have RLS enabled. The user-scoped client respects these policies. The admin client (service role) bypasses them entirely. This means:

- Frontend and user-facing server actions use the user-scoped client and can only access data permitted by RLS policies.
- Background processes (webhooks, cron, admin operations) use the admin client and can read/write any row.

## Storage

All uploaded media (images and videos) is stored in the `scheduled-videos` storage bucket.

### Upload

Files are uploaded using signed URLs:

1. Generate a signed upload URL for the path `{userId}/{uuid}.{ext}`.
2. Client uploads the file to the signed URL.

### Retrieval

Files are accessed using signed view URLs:

1. Generate a signed URL for the stored file path.
2. The signed URL is used by the platform API (e.g., TikTok pulls from the URL) or downloaded as a Buffer (e.g., LinkedIn upload).

### Path Format

All files follow the pattern `{userId}/{uuid}.{ext}`, where:

- `userId` is the Clerk user ID
- `uuid` is a generated unique identifier
- `ext` is the file extension

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (client-side) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public key (client-side) |
| `SUPABASE_SERVICE_ROLE` | Supabase service role key (server-side, bypasses RLS) |

---

[Back to Integrations](./README.md) | [Back to docs](../README.md) | [Back to project root](../../README.md)
