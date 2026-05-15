import { randomBytes } from "node:crypto";

/**
 * Generates a webhook signing secret with the `whsec_` prefix and
 * 32 bytes of hex (64 chars). Shown to the user once at creation
 * time. Stored in DB as-is (not hashed, because the delivery
 * worker needs the raw secret to sign outbound payloads).
 */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("hex")}`;
}
