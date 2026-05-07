# API Route Reference

All HTTP routes exposed by Sharetopus. Routes are defined in `src/app/api/` using the Next.js App Router convention.

## Social OAuth Initiate

Start the OAuth flow for a social platform. Requires Clerk authentication, an active subscription, and the user must be under their plan's account limit.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/social/linkedin/initiate` | Clerk + subscription + account limits | Begin LinkedIn OAuth flow |
| POST | `/api/social/tiktok/initiate` | Clerk + subscription + account limits | Begin TikTok OAuth flow |
| POST | `/api/social/pinterest/initiate` | Clerk + subscription + account limits | Begin Pinterest OAuth flow |
| POST | `/api/social/instagram/initiate` | Clerk + subscription + account limits | Begin Instagram OAuth flow |

## Social OAuth Callback

Handle the redirect back from the social platform after the user authorizes. Validates the CSRF state cookie set during initiation.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/social/linkedin/connect` | Clerk + CSRF cookie | LinkedIn OAuth callback |
| GET | `/api/social/tiktok/connect` | Clerk + CSRF cookie | TikTok OAuth callback |
| GET | `/api/social/pinterest/connect` | Clerk + CSRF cookie | Pinterest OAuth callback |
| GET | `/api/social/instagram/connect` | Clerk + CSRF cookie | Instagram OAuth callback |

## Social Posting

Publish content to a social platform. These are internal routes called by the scheduling system, not by users directly.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/social/linkedin/post` | Internal (no user auth) | Post content to LinkedIn |
| POST | `/api/social/tiktok/post` | Internal (no user auth) | Post content to TikTok |
| POST | `/api/social/pinterest/post` | Internal (no user auth) | Post content to Pinterest |
| POST | `/api/social/instagram/post` | Internal (no user auth) | Post content to Instagram |

## Social Processing

Process a scheduled post for a platform. Called internally by the cron/scheduling pipeline.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/social/linkedin/process` | Internal (no user auth) | Process a scheduled LinkedIn post |
| POST | `/api/social/tiktok/process` | Internal (no user auth) | Process a scheduled TikTok post |
| POST | `/api/social/pinterest/process` | Internal (no user auth) | Process a scheduled Pinterest post |
| POST | `/api/social/instagram/process` | Internal (no user auth) | Process a scheduled Instagram post |

## Storage

Upload and view media files stored in Supabase storage.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/storage/generate-upload-url` | Clerk + subscription | Generate a signed upload URL for media |
| POST | `/api/storage/generate-view-url` | None | Generate a signed view URL for stored media |
| GET | `/api/media` | Query params | Retrieve media metadata |

## Webhooks

Receive events from external services. Each webhook route validates the request signature from its respective service.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/webhooks/stripe` | Stripe signature | Handle Stripe subscription and invoice events |
| POST | `/api/webhooks/clerk` | Svix signature | Handle Clerk user lifecycle events |

## Cron

Scheduled job endpoints triggered on a timer.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/cron/process-scheduled-posts` | Bearer `CRON_SECRET_KEY` | Find and process posts that are due for publishing |

## MCP

Model Context Protocol server endpoint supporting both Streamable HTTP and SSE transports.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET, POST | `/api/mcp/[transport]` | Bearer API key or OAuth | MCP server (tools, resources, prompts) |

## Auth

Clerk authentication catch-all. This is not a user-navigable route.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/auth/[clerk]` | Clerk catch-all | Internal Clerk auth handlers |

## OAuth Discovery

Standard discovery endpoint per RFC 9728.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/.well-known/oauth-protected-resource` | None | OAuth protected resource metadata (RFC 9728) |

---

[Back to Reference](./README.md) | [Back to docs](../README.md) | [Back to project root](../../README.md)
