import { createHmac } from "node:crypto";

/**
 * Signs a webhook payload with HMAC-SHA256 using the subscription's
 * secret. Returns the hex digest.
 *
 * The receiver verifies by recomputing the digest with the same
 * secret + raw body and comparing via constant-time compare.
 * Algorithm and hex encoding match Stripe/GitHub conventions.
 */
export function signWebhookPayload(
  payloadString: string,
  secret: string,
): string {
  return createHmac("sha256", secret).update(payloadString).digest("hex");
}
