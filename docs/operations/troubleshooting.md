# Troubleshooting

Common issues and how to fix them.

## Rate Limiting (429 Response)

**Symptom:** API requests return HTTP 429 (Too Many Requests).

**Cause:** Upstash Redis rate limiting has been triggered.

**Fix:** Wait for the rate limit window to expire and retry. If you are hitting limits during development, check your Upstash Redis configuration and the rate limit settings in `src/actions/api/upstash.ts`.

## OAuth State Mismatch (CSRF Error)

**Symptom:** After authorizing on a social platform, the callback fails with a CSRF or state mismatch error.

**Cause:** The CSRF state cookie set during the `/initiate` step does not match the state parameter returned in the callback. This can happen if cookies were cleared between steps, if the browser blocks third-party cookies, or if the user waited too long before completing authorization.

**Fix:** Clear your browser cookies for the Sharetopus domain and restart the OAuth flow from the beginning.

## Webhook Signature Failure (400 from Webhook Routes)

**Symptom:** The Stripe or Clerk webhook endpoint returns HTTP 400.

**Cause:** The webhook signing secret in the environment does not match the secret used by the service to sign the request.

**Fix:**
- For **Stripe**: verify that `STRIPE_WEBHOOK_SECRET` (production) or `STRIPE_WEBHOOK_SECRET_DEV` (development) matches the signing secret shown in the Stripe dashboard or Stripe CLI output.
- For **Clerk**: verify that `CLERK_WEBHOOK_SECRET` (production) or `CLERK_WEBHOOK_SECRET_DEV` (development) matches the signing secret in the Clerk dashboard.
- Make sure you are using the correct variable for your environment. The app selects the dev or prod secret based on `NODE_ENV`.

## Scheduled Posts Not Processing

**Symptom:** Posts with status `scheduled` remain stuck and never move to `processing` or `posted`.

**Cause:** The cron endpoint at `/api/cron/process-scheduled-posts` is not being called, or it is being called with the wrong authorization token.

**Fix:**
1. Verify that `CRON_SECRET_KEY` is set in your environment variables and matches what the cron trigger sends as a Bearer token.
2. Verify that QStash is configured and has the correct endpoint URL. Check the `QSTASH_TOKEN` variable and the QStash dashboard for delivery logs.
3. In development, you can manually trigger the cron endpoint with:

```bash
curl -X POST http://localhost:3000/api/cron/process-scheduled-posts \
  -H "Authorization: Bearer YOUR_CRON_SECRET_KEY"
```

## Instagram Token Expiry

**Symptom:** Instagram posts fail after the access token expires.

**Cause:** Instagram does not provide a refresh token. When the access token expires, there is no way to renew it automatically.

**Fix:** The user must disconnect and reconnect their Instagram account through the OAuth flow to obtain a new access token.

---

[Back to Operations](./README.md) | [Back to docs](../README.md) | [Back to project root](../../README.md)
