# Upstash Integration

Sharetopus uses Upstash for two purposes: rate limiting (Redis) and scheduled post processing (QStash).

## Packages

| Package | Version | Purpose |
|---------|---------|---------|
| `@upstash/redis` | `^1.38.0` | Redis client for rate limit storage |
| `@upstash/ratelimit` | `^2.0.8` | Rate limiting library |
| `@upstash/qstash` | `^2.10.1` | Scheduled job triggering |

## Rate Limiting

Rate limits use a sliding window algorithm, keyed per `userId`. Each endpoint has its own limiter.

### Rate Limits

| Endpoint / Action | Limit | Window |
|-------------------|-------|--------|
| `fetchSocialAccounts` | 30 | 1 minute |
| `getPinterestBoards` | 15 | 1 minute |
| `stripeCheckOutSession` | 15 | 1 minute |
| `createCustomerPortal` | 20 | 1 minute |
| `getScheduledPosts` | 60 | 1 minute |
| `directPostLinkedIn` | 25 | 1 minute |

When a user exceeds the limit for an endpoint, the request is rejected until the sliding window resets.

## QStash - Scheduled Post Processing

QStash triggers a cron job that processes scheduled posts. When the cron fires, it calls the app's processing endpoint, which then:

1. Finds posts scheduled for the current time window.
2. Processes each post by calling the appropriate platform API (LinkedIn, TikTok, Pinterest, Instagram).
3. Updates the post status in the database.

The cron endpoint is authenticated with `CRON_SECRET_KEY` as a bearer token.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST authentication token |
| `QSTASH_TOKEN` | Upstash QStash token for scheduling post delivery |

---

[Back to Integrations](./README.md) | [Back to docs](../README.md) | [Back to project root](../../README.md)
